import pytest
from backend.core import estimate_tokens
from backend.llama import CONTEXT
from backend.prompt import prepare_messages


def test_five_chinese_passages_fit_the_prompt():
    sources = [{'id': i, 'name': '小說.epub', 'page': i, 'location': '第一章', 'text': '主角在雨夜和朋友交換了秘密。' * 30} for i in range(1, 6)]
    _, selected = prepare_messages('主角交換了什麼？', sources, [], 1200)
    assert [s['text'] for s in selected] == [s['text'] for s in sources]


@pytest.mark.parametrize('reading_mode', ['standard', 'fiction'])
def test_long_multilingual_prompt_keeps_evidence_inside_budget(reading_mode):
    sources = [{'id': i, 'name': '研究文件.pdf', 'page': i, 'text': '中文資料與重要發現。' * 150} for i in range(1, 7)]
    history = [{'role': 'user' if i % 2 == 0 else 'assistant', 'content': '過去的對話內容' * 500} for i in range(4)]
    for output_limit in (100, 1200, 2000):
        messages, selected = prepare_messages('問題' * 500, sources, history, output_limit, reading_mode)
        assert sum(estimate_tokens(m['content']) for m in messages) + output_limit + 400 <= CONTEXT
        assert selected
        assert all(s['text'] in messages[-1]['content'] for s in selected)


def test_question_with_braces_is_literal():
    messages, _ = prepare_messages('What does {example} mean?', [{'id': 1, 'name': 'notes', 'page': 1, 'text': 'An example.'}], [], 1200)
    assert '{example}' in messages[-1]['content']
