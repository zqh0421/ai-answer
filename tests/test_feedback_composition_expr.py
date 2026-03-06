from api.services.feedback_composition_expr import CompositionExprError, compile_condition_expression


def test_condition_expression_evaluates_true():
    compiled = compile_condition_expression("attempted_count >= 2 && wrong_count > 0")
    assert compiled.evaluate({"attempted_count": 3, "wrong_count": 1, "correct_count": 2}) is True


def test_condition_expression_evaluates_false():
    compiled = compile_condition_expression("correct_count >= 1 && wrong_count == 0")
    assert compiled.evaluate({"attempted_count": 2, "wrong_count": 1, "correct_count": 1}) is False


def test_unknown_variable_raises():
    try:
        compile_condition_expression("total_submission_count > 1")
        assert False, "expected unknown variable error"
    except CompositionExprError as exc:
        assert exc.code == "UNKNOWN_VARIABLE"


def test_type_error_raises():
    try:
        compile_condition_expression("attempted_count && TRUE")
        assert False, "expected type error"
    except CompositionExprError as exc:
        assert exc.code == "TYPE_ERROR"


def test_syntax_error_raises():
    try:
        compile_condition_expression("attempted_count >")
        assert False, "expected syntax error"
    except CompositionExprError as exc:
        assert exc.code == "SYNTAX_ERROR"
