from dataclasses import asdict, is_dataclass
from typing import List

# Shared bucket so the runner can read scraped items after the crawl finishes.
COLLECTED_ITEMS: List[dict] = []


class CollectItemsPipeline:
    """Pipeline that collects items into a provided list reference."""

    def __init__(self, bucket=None):
        self.bucket = bucket if bucket is not None else COLLECTED_ITEMS

    @classmethod
    def from_crawler(cls, crawler):
        # Always share the same module-level list so the runner can read it
        return cls(COLLECTED_ITEMS)

    def process_item(self, item, spider):
        if is_dataclass(item):
            self.bucket.append(asdict(item))
        else:
            try:
                self.bucket.append(dict(item))
            except Exception:
                self.bucket.append(item)
        return item
