import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from tests.env_setup import apply_test_env

apply_test_env()

from api.models.visionModel import VisionModel
from api.routers import conversion as conversion_router
from api.services import vision_jobs
from api.v2 import index_shared as v2_shared_router


class VisionWrapperRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_v1_conversion_openai_vision_uses_background_wrapper(self):
        with patch.object(conversion_router, "run_openai_blocking", new=AsyncMock(return_value="vision-output")) as mocked_runner:
            result = await conversion_router.vision(VisionModel(base64_image_arr=["aGVsbG8="]), settings=object())

        self.assertEqual(result, "vision-output")
        mocked_runner.assert_awaited_once()

    async def test_v2_shared_vision_uses_background_wrapper(self):
        with patch.object(v2_shared_router, "run_openai_blocking", new=AsyncMock(return_value="slide-content")) as mocked_runner:
            result = await v2_shared_router.vision(VisionModel(base64_image_arr=["aGVsbG8="]), settings=object())

        self.assertEqual(result["slide_content"], "slide-content")
        mocked_runner.assert_awaited_once()


class VisionExecutionConsistencyTests(unittest.TestCase):
    def test_run_vision_for_slide_returns_same_text_as_page_updates(self):
        class _FakeQueryForRun:
            def __init__(self, first_value=None, all_value=None):
                self._first_value = first_value
                self._all_value = all_value or []

            def filter(self, *_args, **_kwargs):
                return self

            def first(self):
                return self._first_value

            def all(self):
                return self._all_value

        class _FakeSessionForRun:
            def __init__(self, slide_obj, pages_obj):
                self.slide_obj = slide_obj
                self.pages_obj = pages_obj
                self.committed = False
                self.closed = False
                self.rolled_back = False

            def query(self, model):
                if model is vision_jobs.schema.Slide:
                    return _FakeQueryForRun(first_value=self.slide_obj)
                if model is vision_jobs.schema.Page:
                    return _FakeQueryForRun(all_value=self.pages_obj)
                return _FakeQueryForRun()

            def commit(self):
                self.committed = True

            def rollback(self):
                self.rolled_back = True

            def close(self):
                self.closed = True

        slide = SimpleNamespace(id="slide-1", slide_google_id="google-1", vision_summary=None)
        pages = [
            SimpleNamespace(page_number=0, img_base64="aGVsbG8=", image_text=None, vector=None),
            SimpleNamespace(page_number=1, img_base64="d29ybGQ=", image_text=None, vector=None),
        ]
        fake_session = _FakeSessionForRun(slide, pages)

        def _fake_set_vision(imgs, settings=None):
            if len(imgs) == 1:
                return f"vision-{imgs[0]}"
            return "summary-all-pages"

        with patch.object(vision_jobs, "SessionLocal", return_value=fake_session), patch.object(
            vision_jobs, "setVision", side_effect=_fake_set_vision
        ), patch.object(vision_jobs, "embed_slide", return_value=[[0.1], [0.2]]):
            result = vision_jobs.run_vision_for_slide("slide-1", "google-1", settings=object())

        self.assertTrue(fake_session.committed)
        self.assertTrue(fake_session.closed)
        self.assertFalse(fake_session.rolled_back)
        self.assertEqual(result["vision_summary"], "summary-all-pages")
        self.assertEqual(result["processed_pages"], 2)
        self.assertEqual(result["page_vision_texts"][0]["image_text"], pages[0].image_text)
        self.assertEqual(result["page_vision_texts"][1]["image_text"], pages[1].image_text)
        self.assertEqual(pages[0].image_text, "vision-aGVsbG8=")
        self.assertEqual(pages[1].image_text, "vision-d29ybGQ=")


if __name__ == "__main__":
    unittest.main()
