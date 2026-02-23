from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Callable, Dict, Optional

from .. import schema
from ..database import SessionLocal
from ..config import Settings, get_settings
from ..utils import embed_slide
from ..controllers.vision import setVision


def _page_vision_max_workers() -> int:
    workers = get_settings().vision_page_max_workers
    return workers if workers > 0 else 4


def run_vision_for_slide(
    slide_id: str,
    slide_google_id: str,
    settings: Settings,
    force_process_all: bool = True,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    db = SessionLocal()
    try:
        slide = db.query(schema.Slide).filter(schema.Slide.id == slide_id, schema.Slide.slide_google_id == slide_google_id).first()
        if not slide:
            raise ValueError("Slide not found")

        pages = db.query(schema.Page).filter(schema.Page.slide_id == slide_id).all()
        if not pages:
            raise ValueError("No pages found for this slide")

        processed_pages = 0
        page_vision_texts = []
        total_steps = len(pages) + 1  # page vision per page + slide summary
        pages_sorted = sorted(pages, key=lambda page: page.page_number)

        def _emit_page_progress(page_obj, step_kind: str) -> None:
            nonlocal processed_pages
            processed_pages += 1
            if progress_callback:
                progress_callback(
                    {
                        "completed_steps": min(processed_pages, total_steps),
                        "total_steps": total_steps,
                        "current_step_label": f"page_{page_obj.page_number + 1}_{step_kind}",
                    }
                )

        pages_needing_vision = []
        pages_for_vector = []
        for page in pages_sorted:
            needs_vision = force_process_all or not page.image_text
            needs_vector = force_process_all or (page.vector is None)
            if needs_vision and page.img_base64:
                pages_needing_vision.append(page)
            if needs_vector:
                pages_for_vector.append(page)

        def _vision_page(page_obj):
            return page_obj.page_number, setVision([page_obj.img_base64], settings=settings)

        if pages_needing_vision:
            max_workers = min(_page_vision_max_workers(), len(pages_needing_vision))
            with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="page-vision") as page_pool:
                future_to_page = {page_pool.submit(_vision_page, page): page for page in pages_needing_vision}
                for future in future_to_page:
                    # no-op iteration to keep dictionary evaluated before as_completed import use
                    pass
                from concurrent.futures import as_completed

                for future in as_completed(future_to_page):
                    page = future_to_page[future]
                    page_number, image_text = future.result()
                    page.image_text = image_text
                    page.updated_at = datetime.utcnow()
                    page_vision_texts.append({"page_number": page_number, "image_text": image_text})
                    _emit_page_progress(page, "vision")
            page_vision_texts.sort(key=lambda item: item["page_number"])

        # In incremental mode, count already-complete pages toward progress after
        # we schedule/run the missing work so the UI still gets per-page advancement.
        if not force_process_all:
            for page in pages_sorted:
                if page in pages_needing_vision:
                    continue
                _emit_page_progress(page, "skipped")

        should_generate_summary = force_process_all or not slide.vision_summary
        img_base64_list = [page.img_base64 for page in pages_sorted if page.img_base64]
        if should_generate_summary and img_base64_list:
            slide.vision_summary = setVision(img_base64_list, settings=settings)
        if progress_callback:
            progress_callback(
                {
                    "completed_steps": total_steps,
                    "total_steps": total_steps,
                    "current_step_label": "slide_summary" if should_generate_summary else "slide_summary_skipped",
                }
            )

        try:
            if progress_callback:
                progress_callback(
                    {
                        "completed_steps": total_steps,
                        "total_steps": total_steps,
                        "current_step_label": "vectors",
                    }
                )
            image_texts = []
            pages_with_image_text = []
            for page in pages_for_vector:
                if page.image_text:
                    image_texts.append(page.image_text)
                    pages_with_image_text.append(page)

            if image_texts:
                vectors = embed_slide(image_texts, settings)
                for i, page in enumerate(pages_with_image_text):
                    if i < len(vectors):
                        page.vector = vectors[i]
                        page.updated_at = datetime.utcnow()
        except Exception:
            # Keep vision text update successful even when embeddings fail.
            pass

        db.commit()
        return {
            "message": "Vision processed successfully",
            "slide_id": slide_id,
            "processed_pages": processed_pages,
            "total_pages": len(pages),
            "vision_summary": slide.vision_summary,
            "page_vision_texts": page_vision_texts,
        }
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
