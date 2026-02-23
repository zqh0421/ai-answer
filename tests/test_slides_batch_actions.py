import unittest
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from tests.env_setup import apply_test_env

apply_test_env()

from api.models.userModel import SlideBatchDeleteRequest, SlideBatchProcessRequest
from api.routers import slides as slides_router


class _FakeQuery:
    def __init__(self, all_value=None):
        self._all_value = all_value or []

    def filter(self, *_args, **_kwargs):
        return self

    def all(self):
        return self._all_value

    def group_by(self, *_args, **_kwargs):
        return self


class _FakeDB:
    def __init__(self, slides=None, pages=None):
        self.bind = object()
        self._slides = slides or []
        self._pages = pages or []
        self.added = []
        self.deleted_ids = []
        self.committed = False

    def query(self, *models):
        if len(models) == 1 and models[0] is slides_router.schema.Slide:
            return _FakeQuery(all_value=self._slides)
        if len(models) == 1 and models[0] is slides_router.schema.Page:
            return _FakeQuery(all_value=self._pages)
        return _FakeQuery(all_value=[])

    def delete(self, slide):
        self.deleted_ids.append(str(slide.id))

    def add(self, obj):
        self.added.append(obj)

    def flush(self):
        for obj in self.added:
            if isinstance(obj, slides_router.schema.SlideProcessJob) and not obj.job_id:
                obj.job_id = uuid4()

    def commit(self):
        self.committed = True


class SlidesBatchActionTests(unittest.IsolatedAsyncioTestCase):
    async def test_process_batch_queues_job_and_items(self):
        slide_id = str(uuid4())
        fake_slide = SimpleNamespace(id=slide_id, slide_google_id="google-1", vision_summary=None)
        db = _FakeDB(slides=[fake_slide], pages=[])
        with patch.object(slides_router, "ensure_slide_batch_job_schema"), patch.object(
            slides_router, "ensure_slide_page_import_job_schema"
        ), patch.object(
            slides_router, "recompute_job_aggregate"
        ), patch.object(
            slides_router.slide_batch_job_manager, "enqueue_job"
        ) as mocked_enqueue:
            result = await slides_router.process_slides_batch(
                payload=SlideBatchProcessRequest(slide_ids=[slide_id], force_process_all=False),
                request=SimpleNamespace(headers={"X-User-Id": "u1"}),
                db=db,
            )
        mocked_enqueue.assert_called_once()
        self.assertEqual(result["status"], "queued")
        self.assertEqual(result["total_count"], 1)
        self.assertIn("job_id", result)

    async def test_delete_batch_deletes_existing_ids(self):
        slide_id = str(uuid4())
        fake_slide = SimpleNamespace(id=slide_id)
        db = _FakeDB(slides=[fake_slide], pages=[])

        result = slides_router.delete_slides_batch(
            payload=SlideBatchDeleteRequest(slide_ids=[slide_id]),
            db=db,
        )

        self.assertTrue(db.committed)
        self.assertEqual(db.deleted_ids, [slide_id])
        self.assertEqual(result["deleted_count"], 1)
        self.assertEqual(result["invalid_slide_ids"], [])


if __name__ == "__main__":
    unittest.main()
