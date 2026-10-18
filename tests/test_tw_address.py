import unittest

from src.core.tw_address import add_road, parse_zip_csv, roads_for


class _Mem:
    def __init__(self) -> None:
        self.data: dict = {}

    def get_json_setting(self, key, default=None):
        return self.data.get(key, default)

    def set_json_setting(self, key, value) -> None:
        self.data[key] = value


class TwAddressTests(unittest.TestCase):
    def test_parse_and_local_road(self) -> None:
        book = parse_zip_csv(
            "ZIPCODE,CITY,AREA,ROAD,SCOOP\n"
            "704005,\u81fa\u5357\u5e02,\u5317\u5340,\u5317\u5b89\u8def\u4e00\u6bb5,\u5168\n",
            updated="2026-06-01",
        )
        self.assertEqual(book["cities"][0]["name"], "\u53f0\u5357\u5e02")
        self.assertEqual(book["cities"][0]["districts"][0]["zip"], "704")
        self.assertIn("\u5317\u5b89\u8def\u4e00\u6bb5", book["cities"][0]["districts"][0]["roads"])

    def test_bundled_north_district_and_local_add(self) -> None:
        store = _Mem()
        hit = roads_for(store, "\u53f0\u5357\u5e02", "\u5317\u5340")
        self.assertEqual(hit["zip"], "704")
        self.assertIn("\u5317\u5b89\u8def\u4e00\u6bb5", hit["roads"])
        add_road(store, "\u53f0\u5357\u5e02", "\u5317\u5340", "\u6e2c\u8a66\u65b0\u8def")
        again = roads_for(store, "\u53f0\u5357\u5e02", "\u5317\u5340")
        self.assertIn("\u6e2c\u8a66\u65b0\u8def", again["local"])


if __name__ == "__main__":
    unittest.main()
