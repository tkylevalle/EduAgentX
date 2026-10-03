const reviewStore = new Map(); // package_id -> array of reviews

async function submitReview(package_id, review) {
  if (!reviewStore.has(package_id)) reviewStore.set(package_id, []);
  reviewStore.get(package_id).push(review);
}

async function getReviews(package_id) {
  return reviewStore.get(package_id) || [];
}

module.exports = { submitReview, getReviews };
