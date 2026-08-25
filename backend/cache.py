"""In-process result cache for the streaming profile.

Keyed by (content hash, options). A small, bounded LRU so repeated profile
requests for the same file skip the two-pass computation entirely. Per-worker
memory only — for a horizontally-scaled deployment this should move to a shared
store (Redis etc.).
"""

from __future__ import annotations

from collections import OrderedDict

MAX_ENTRIES = 8


class ProfileCache:
    """Bounded LRU cache mapping (fileHash, options) -> response dict."""

    def __init__(self, max_entries: int = MAX_ENTRIES) -> None:
        self._max = max_entries
        self._data: OrderedDict[tuple, object] = OrderedDict()

    def get(self, key: tuple) -> object | None:
        val = self._data.get(key)
        if val is not None:
            self._data.move_to_end(key)
        return val

    def put(self, key: tuple, value: object) -> None:
        self._data[key] = value
        self._data.move_to_end(key)
        while len(self._data) > self._max:
            self._data.popitem(last=False)

    def invalidate(self) -> None:
        self._data.clear()

    def __len__(self) -> int:
        return len(self._data)
