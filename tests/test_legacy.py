"""Exercise legacy classes without importing optional GPU/parser dependencies."""
import ast
import logging
import numpy as np
from pathlib import Path
from typing import Dict, List, Any


def legacy_class(name):
    tree = ast.parse(Path('rag_system.py').read_text(encoding='utf-8'))
    selected = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == name]
    namespace = {'np': np, 'List': List, 'Dict': Dict, 'Any': Any, 'RAGConfig': object, 'logger': logging.getLogger('legacy')}
    exec(compile(ast.Module(body=selected, type_ignores=[]), 'rag_system.py', 'exec'), namespace)
    return namespace[name]


def test_legacy_splitter_no_duplicate_tail():
    splitter = legacy_class('TextSplitter')()
    assert len(splitter.split_text('x' * 1200)) == 2


def test_legacy_faiss_has_finalize():
    assert hasattr(legacy_class('FAISSVectorStore'), 'build_index')
