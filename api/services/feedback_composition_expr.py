from __future__ import annotations

from dataclasses import dataclass
from typing import Any


MAX_EXPRESSION_LENGTH = 2000
ALLOWED_VARIABLES: dict[str, str] = {
    "attempted_count": "number",
    "wrong_count": "number",
    "correct_count": "number",
}


class CompositionExprError(ValueError):
    def __init__(self, code: str, message: str, position: int | None = None):
        self.code = code
        self.position = position
        detail = message if position is None else f"{message} at position {position}"
        super().__init__(detail)


@dataclass(frozen=True)
class _Token:
    kind: str
    value: str
    pos: int


@dataclass(frozen=True)
class CompiledCondition:
    expr: str
    ast: Any

    def evaluate(self, context: dict[str, Any]) -> bool:
        return bool(_eval(self.ast, context))


def compile_condition_expression(expr: str) -> CompiledCondition:
    if not isinstance(expr, str):
        raise CompositionExprError("SYNTAX_ERROR", "expression must be a string")
    if len(expr) > MAX_EXPRESSION_LENGTH:
        raise CompositionExprError("EXPRESSION_TOO_LONG", f"expression exceeds {MAX_EXPRESSION_LENGTH} characters")

    tokens = _tokenize(expr)
    parser = _Parser(tokens)
    ast = parser.parse()
    _type_check(ast)
    return CompiledCondition(expr=expr, ast=ast)


def _tokenize(expr: str) -> list[_Token]:
    tokens: list[_Token] = []
    i = 0
    n = len(expr)
    while i < n:
        c = expr[i]
        if c.isspace():
            i += 1
            continue

        two = expr[i : i + 2]
        if two in {"&&", "||", "==", "!=", ">=", "<="}:
            tokens.append(_Token("OP", two, i))
            i += 2
            continue
        if c in {">", "<"}:
            tokens.append(_Token("OP", c, i))
            i += 1
            continue
        if c == "(":
            tokens.append(_Token("LPAREN", c, i))
            i += 1
            continue
        if c == ")":
            tokens.append(_Token("RPAREN", c, i))
            i += 1
            continue
        if c.isdigit():
            start = i
            i += 1
            while i < n and expr[i].isdigit():
                i += 1
            tokens.append(_Token("NUMBER", expr[start:i], start))
            continue
        if c.isalpha() or c == "_":
            start = i
            i += 1
            while i < n and (expr[i].isalnum() or expr[i] == "_"):
                i += 1
            word = expr[start:i]
            upper = word.upper()
            if upper in {"TRUE", "FALSE"}:
                tokens.append(_Token("BOOL", upper, start))
            else:
                tokens.append(_Token("IDENT", word, start))
            continue

        raise CompositionExprError("SYNTAX_ERROR", f"unexpected character '{c}'", i)

    tokens.append(_Token("EOF", "", n))
    return tokens


class _Parser:
    def __init__(self, tokens: list[_Token]):
        self.tokens = tokens
        self.idx = 0

    def _cur(self) -> _Token:
        return self.tokens[self.idx]

    def _advance(self) -> _Token:
        tok = self._cur()
        self.idx += 1
        return tok

    def _expect(self, kind: str) -> _Token:
        tok = self._cur()
        if tok.kind != kind:
            raise CompositionExprError("SYNTAX_ERROR", f"expected {kind}, got {tok.kind}", tok.pos)
        self.idx += 1
        return tok

    def parse(self) -> Any:
        node = self._parse_or()
        end = self._cur()
        if end.kind != "EOF":
            raise CompositionExprError("SYNTAX_ERROR", "unexpected trailing token", end.pos)
        return node

    def _parse_or(self) -> Any:
        node = self._parse_and()
        while self._cur().kind == "OP" and self._cur().value == "||":
            op = self._advance()
            right = self._parse_and()
            node = ("bin", op.value, node, right, op.pos)
        return node

    def _parse_and(self) -> Any:
        node = self._parse_comparison()
        while self._cur().kind == "OP" and self._cur().value == "&&":
            op = self._advance()
            right = self._parse_comparison()
            node = ("bin", op.value, node, right, op.pos)
        return node

    def _parse_comparison(self) -> Any:
        node = self._parse_primary()
        if self._cur().kind == "OP" and self._cur().value in {"==", "!=", ">", "<", ">=", "<="}:
            op = self._advance()
            right = self._parse_primary()
            node = ("bin", op.value, node, right, op.pos)
        return node

    def _parse_primary(self) -> Any:
        tok = self._cur()
        if tok.kind == "NUMBER":
            self._advance()
            return ("number", int(tok.value), tok.pos)
        if tok.kind == "BOOL":
            self._advance()
            return ("bool", tok.value == "TRUE", tok.pos)
        if tok.kind == "IDENT":
            self._advance()
            return ("var", tok.value, tok.pos)
        if tok.kind == "LPAREN":
            self._advance()
            node = self._parse_or()
            self._expect("RPAREN")
            return node
        raise CompositionExprError("SYNTAX_ERROR", f"unexpected token {tok.kind}", tok.pos)


def _type_check(node: Any) -> str:
    kind = node[0]
    if kind == "number":
        return "number"
    if kind == "bool":
        return "bool"
    if kind == "var":
        name = node[1]
        pos = node[2]
        typ = ALLOWED_VARIABLES.get(name)
        if typ is None:
            raise CompositionExprError("UNKNOWN_VARIABLE", f"unknown variable '{name}'", pos)
        return typ
    if kind == "bin":
        op = node[1]
        left = node[2]
        right = node[3]
        pos = node[4]
        lt = _type_check(left)
        rt = _type_check(right)

        if op in {"&&", "||"}:
            if lt != "bool" or rt != "bool":
                raise CompositionExprError("TYPE_ERROR", f"operator '{op}' requires boolean operands", pos)
            return "bool"
        if op in {">", "<", ">=", "<="}:
            if lt != "number" or rt != "number":
                raise CompositionExprError("TYPE_ERROR", f"operator '{op}' requires numeric operands", pos)
            return "bool"
        if op in {"==", "!="}:
            if lt != rt:
                raise CompositionExprError("TYPE_ERROR", f"operator '{op}' requires operands of same type", pos)
            return "bool"

    raise CompositionExprError("SYNTAX_ERROR", "invalid expression tree")


def _eval(node: Any, context: dict[str, Any]) -> Any:
    kind = node[0]
    if kind == "number":
        return int(node[1])
    if kind == "bool":
        return bool(node[1])
    if kind == "var":
        name = node[1]
        if name not in ALLOWED_VARIABLES:
            raise CompositionExprError("UNKNOWN_VARIABLE", f"unknown variable '{name}'")
        try:
            return int(context.get(name, 0))
        except Exception as exc:
            raise CompositionExprError("TYPE_ERROR", f"context variable '{name}' must be numeric") from exc
    if kind == "bin":
        op = node[1]
        if op == "&&":
            return bool(_eval(node[2], context)) and bool(_eval(node[3], context))
        if op == "||":
            return bool(_eval(node[2], context)) or bool(_eval(node[3], context))
        left = _eval(node[2], context)
        right = _eval(node[3], context)
        if op == "==":
            return left == right
        if op == "!=":
            return left != right
        if op == ">":
            return left > right
        if op == "<":
            return left < right
        if op == ">=":
            return left >= right
        if op == "<=":
            return left <= right
    raise CompositionExprError("SYNTAX_ERROR", "invalid expression tree")
