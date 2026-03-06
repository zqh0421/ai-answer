from unittest.mock import patch

from tests.env_setup import apply_test_env

apply_test_env()

from api.routers import questions_semantic as qs_router


def test_option_order_policy_keeps_original_order_when_random_disabled():
    interactions = [
        {
            "interaction_id": "qi_1",
            "options": [{"option_order": 1, "text": "A"}, {"option_order": 2, "text": "B"}],
        }
    ]

    result = qs_router._apply_option_order_policy(interactions, randomize_option_order=False)

    assert [x["text"] for x in result[0]["options"]] == ["A", "B"]
    assert result[0]["interaction_options"] == result[0]["options"]


def test_option_order_policy_shuffles_when_random_enabled():
    interactions = [
        {
            "interaction_id": "qi_1",
            "options": [{"option_order": 1, "text": "A"}, {"option_order": 2, "text": "B"}],
        }
    ]

    shuffled = [interactions[0]["options"][1], interactions[0]["options"][0]]
    with patch.object(qs_router, "_shuffle_options", return_value=shuffled) as mock_shuffle:
        result = qs_router._apply_option_order_policy(interactions, randomize_option_order=True)

    mock_shuffle.assert_called_once()
    assert [x["text"] for x in result[0]["options"]] == ["B", "A"]
    assert [x["option_order"] for x in result[0]["options"]] == [1, 2]
    assert [x["source_option_order"] for x in result[0]["options"]] == [2, 1]
    assert result[0]["interaction_options"] == result[0]["options"]
