BOT_NAME = "price_oracle.pokespider"
SPIDER_MODULES = ["price_oracle.pokespider.pokespider.spiders"]
NEWSPIDER_MODULE = "price_oracle.pokespider.pokespider.spiders"

ROBOTSTXT_OBEY = False
CONCURRENT_REQUESTS = 8
CONCURRENT_ITEMS = 8
COOKIES_ENABLED = True

DEFAULT_REQUEST_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
}

EXTENSIONS = {
    "scrapy.extensions.memusage.MemoryUsage": None,
}

ITEM_PIPELINES = {
   "price_oracle.pokespider.pokespider.pipelines.CollectItemsPipeline": 300,
}

REQUEST_FINGERPRINTER_IMPLEMENTATION = "2.7"
TWISTED_REACTOR = "twisted.internet.asyncioreactor.AsyncioSelectorReactor"
FEED_EXPORT_ENCODING = "utf-8"

DOWNLOAD_HANDLERS = {
    "http": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
    "https": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
}

DOWNLOAD_TIMEOUT = 60
LOG_LEVEL = "INFO"

PLAYWRIGHT_BROWSER_TYPE = "chromium"
PLAYWRIGHT_LAUNCH_OPTIONS = {
    "headless": True,
    "timeout": 60 * 1000,
}

# Disable GUI selection; we inject DEFAULT_SET_LIST via runner.
USE_SET_SELECTION_WINDOW = False
DEFAULT_SET_LIST = []
