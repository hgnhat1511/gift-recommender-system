import unittest

from app.services.recommender import recommend, similar


class RecommenderTests(unittest.TestCase):
    def setUp(self):
        self.products = [
            {"id": "1", "status": "ACTIVE", "stock": 2, "price": 100000, "categoryId": 3,
             "occasionTags": ["birthday"], "recipientTags": ["friend"], "interestTags": ["coffee"],
             "style": "minimal", "giftType": "food", "isFeatured": False},
            {"id": "2", "status": "ACTIVE", "stock": 0, "price": 50000, "categoryId": 3,
             "occasionTags": ["birthday"]},
            {"id": "3", "status": "INACTIVE", "stock": 1, "price": 25000},
        ]

    def test_recommend_filters_unavailable_and_budget(self):
        result = recommend(self.products, context={"budget": 120000, "occasion": "birthday"})
        self.assertEqual([item["id"] for item in result["items"]], ["1"])
        self.assertTrue(any("Đúng dịp" in reason for reason in result["items"][0]["reasons"]))

    def test_activity_weights_affect_rank_and_explain(self):
        preferences = {"interests": {"coffee": 1.0}, "categories": {"3": 0.7}}
        result = recommend(self.products, preferences)
        self.assertEqual(result["items"][0]["id"], "1")
        self.assertEqual(result["method"], "content_baseline")
        self.assertTrue(result["items"][0]["reasons"])

    def test_empty_catalog_is_valid_cold_start(self):
        result = recommend([])
        self.assertEqual(result["items"], [])
        self.assertEqual(result["method"], "popular_cold_start")

    def test_gift_finder_query_matches_product_text(self):
        products = [
            {"id": "10", "status": "ACTIVE", "stock": 1, "price": 50000, "name": "Coffee mug", "description": "Ceramic cup"},
            {"id": "11", "status": "ACTIVE", "stock": 1, "price": 40000, "name": "Paper card"},
        ]
        result = recommend(products, context={"query": "ceramic", "budget": 60000})
        self.assertEqual([item["id"] for item in result["items"]], ["10"])
        self.assertTrue(any("Khớp nội dung" in reason for reason in result["items"][0]["reasons"]))

    def test_similar_excludes_target_and_unavailable_products(self):
        target = self.products[0]
        result = similar(target, self.products + [{**target, "id": "4"}])
        self.assertEqual([item["id"] for item in result["items"]], ["4"])


if __name__ == "__main__":
    unittest.main()
