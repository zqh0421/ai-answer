import unittest
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy.dialects import postgresql

from tests.env_setup import apply_test_env

apply_test_env()

from api import models
from api.routers import modules as modules_router


class _FakeQuery:
    def __init__(self, first_value=None, all_value=None):
        self._first_value = first_value
        self._all_value = all_value or []

    def filter(self, *_args, **_kwargs):
        return self

    def first(self):
        return self._first_value

    def all(self):
        return self._all_value


class _FakeDB:
    def __init__(self, module_exists: bool = True):
        self._module = SimpleNamespace(module_id=uuid4()) if module_exists else None
        self._slides = [
            SimpleNamespace(id=uuid4(), slide_google_id="g1"),
            SimpleNamespace(id=uuid4(), slide_google_id="g2"),
        ]
        self.executed_stmt = None
        self.executed = False
        self.committed = False
        self.rolled_back = False

    def query(self, model):
        if model is modules_router.schema.Module:
            return _FakeQuery(first_value=self._module)
        if model is modules_router.schema.Slide:
            return _FakeQuery(all_value=self._slides)
        return _FakeQuery()

    def execute(self, stmt):
        self.executed_stmt = stmt
        self.executed = True

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True


class SlidesBatchTests(unittest.TestCase):
    def test_batch_upsert_deduplicates_duplicate_google_ids(self):
        db = _FakeDB(module_exists=True)
        module_id = uuid4()
        payload = models.SlidesCreate(
            slides=[
                {"google_id": "g1", "title": "T1", "url": "https://example.com/a.pdf", "cover": "c1"},
                {"google_id": "g1", "title": "T1-new", "url": "https://example.com/a2.pdf", "cover": "c2"},
                {"google_id": "g2", "title": "T2", "url": "https://example.com/b.pdf", "cover": "c3"},
            ]
        )

        fake_page_import_job = SimpleNamespace(
            job_id=uuid4(),
            items=[SimpleNamespace(id=uuid4()), SimpleNamespace(id=uuid4())],
        )
        with patch.object(modules_router, "create_page_import_batch_job", return_value=fake_page_import_job), patch.object(
            modules_router.slide_batch_job_manager, "enqueue_callable", return_value="rq-job-1"
        ) as mocked_enqueue:
            result = modules_router.create_slides_batch(
                module_id=module_id,
                slides=payload,
                request=SimpleNamespace(headers={}),
                settings=object(),
                db=db,
            )

        self.assertTrue(db.executed)
        self.assertTrue(db.committed)
        self.assertFalse(db.rolled_back)
        self.assertEqual(mocked_enqueue.call_count, 2)
        self.assertEqual(result["duplicates_in_payload"], 1)
        self.assertEqual(result["message"], "2 slides upserted successfully!")
        self.assertEqual(result["page_import_jobs_queued"], 2)

        sql = str(db.executed_stmt.compile(dialect=postgresql.dialect()))
        self.assertIn("ON CONFLICT (slide_google_id) DO UPDATE", sql)

    def test_batch_returns_early_for_empty_payload(self):
        db = _FakeDB(module_exists=True)
        result = modules_router.create_slides_batch(
            module_id=uuid4(),
            slides=models.SlidesCreate(slides=[]),
            request=SimpleNamespace(headers={}),
            settings=object(),
            db=db,
        )

        self.assertEqual(result["message"], "No slides to upload")
        self.assertFalse(db.executed)
        self.assertFalse(db.committed)


if __name__ == "__main__":
    unittest.main()
