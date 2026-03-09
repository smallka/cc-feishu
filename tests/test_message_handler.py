"""测试消息处理器"""
import pytest
from src.handlers.message_handler import (
    is_duplicate,
    extract_text,
    resolve_work_path
)


def test_is_duplicate():
    """测试消息去重"""
    assert not is_duplicate('msg1')
    assert is_duplicate('msg1')
    assert not is_duplicate('msg2')


def test_extract_text():
    """测试文本提取"""
    message = {'content': '{"text": "Hello"}'}
    assert extract_text(message) == 'Hello'

    message = {'content': '{"text": "  Trimmed  "}'}
    assert extract_text(message) == 'Trimmed'


def test_resolve_work_path():
    """测试路径解析"""
    # 测试绝对路径
    result = resolve_work_path('/tmp')
    # Windows 上 /tmp 可能不存在，改为测试当前目录
    import os
    result = resolve_work_path(os.getcwd())
    assert result is not None

    # 测试不存在的路径
    result = resolve_work_path('/nonexistent/path/that/does/not/exist')
    assert result is None
