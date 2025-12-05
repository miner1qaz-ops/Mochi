"""
Compatibility shim: delegate to the vendored MainSpider (TCGplayer scraper).

Scrapy still discovers spiders in this module path; we simply re-export MainSpider.
"""
from .main_spider import MainSpider as TcgPriceSpider  # noqa: F401
