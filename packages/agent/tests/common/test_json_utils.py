from agent.common.json_utils import extract_json


class TestExtractJson:
    def test_extract_json_direct_parse(self):
        json_text = '{"key": "value", "number": 42}'
        result = extract_json(json_text)
        assert result == {"key": "value", "number": 42}

    def test_extract_json_with_whitespace(self):
        json_text = '   {"key": "value"}   '
        result = extract_json(json_text)
        assert result == {"key": "value"}

    def test_extract_json_from_markdown_code_block(self):
        text = """Here is some JSON:
```json
{"intent": "research", "confidence": 0.95}
```
That was the JSON."""
        result = extract_json(text)
        assert result == {"intent": "research", "confidence": 0.95}

    def test_extract_json_from_markdown_with_newlines(self):
        text = """```json

{
    "steps": [
        {"tool": "search", "query": "test"}
    ]
}

```"""
        result = extract_json(text)
        assert result == {"steps": [{"tool": "search", "query": "test"}]}

    def test_extract_json_embedded_in_text(self):
        text = 'The result is {"status": "success", "data": [1, 2, 3]} as expected.'
        result = extract_json(text)
        assert result == {"status": "success", "data": [1, 2, 3]}

    def test_extract_json_nested_objects(self):
        text = """Output: {"outer": {"inner": {"deep": "value"}}}"""
        result = extract_json(text)
        assert result == {"outer": {"inner": {"deep": "value"}}}

    def test_extract_json_empty_string(self):
        result = extract_json("")
        assert result is None

    def test_extract_json_none_like_empty(self):
        result = extract_json("   ")
        assert result is None

    def test_extract_json_no_json_present(self):
        result = extract_json("This is just plain text without any JSON.")
        assert result is None

    def test_extract_json_invalid_json(self):
        result = extract_json('{"key": "missing closing brace"')
        assert result is None

    def test_extract_json_array_not_object(self):
        json_text = '[1, 2, 3, "four"]'
        result = extract_json(json_text)
        assert result == [1, 2, 3, "four"]

    def test_extract_json_complex_nested_structure(self):
        text = """Result:
{"decision": "deep", "reasons": ["complexity", "multiple_sources"], "metadata": \
{"score": 0.87, "tags": ["ai", "research"]}}
End."""
        result = extract_json(text)
        assert result == {
            "decision": "deep",
            "reasons": ["complexity", "multiple_sources"],
            "metadata": {"score": 0.87, "tags": ["ai", "research"]},
        }

    def test_extract_json_with_escaped_characters(self):
        json_text = '{"message": "Hello\\nWorld", "path": "C:\\\\Users"}'
        result = extract_json(json_text)
        assert result == {"message": "Hello\nWorld", "path": "C:\\Users"}

    def test_extract_json_boolean_and_null_values(self):
        json_text = '{"active": true, "disabled": false, "optional": null}'
        result = extract_json(json_text)
        assert result == {"active": True, "disabled": False, "optional": None}

    def test_extract_json_from_malformed_markdown(self):
        text = """```json
{"key": "value"}"""
        result = extract_json(text)
        assert result == {"key": "value"}

    def test_extract_json_multiple_objects_returns_first(self):
        text = 'First: {"a": 1} Second: {"b": 2}'
        result = extract_json(text)
        assert result == {"a": 1}
