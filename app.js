/* ==========================================================================
   Suez Bazaar REST DB Dashboard - Core Client Logic
   ========================================================================== */

// Firebase Configuration from user
const firebaseConfig = {
  apiKey: "AIzaSyDvT5RWHn2VStZ8Iy5Abxx7ciztdDLvBDw",
  authDomain: "products-ecbb1.firebaseapp.com",
  projectId: "products-ecbb1",
  storageBucket: "products-ecbb1.firebasestorage.app",
  messagingSenderId: "721833852678",
  appId: "1:721833852678:web:01be69744139a506b7a887",
  measurementId: "G-8WCL31H7EJ"
};

const COLLECTIONS = {
  products: "marketplace_products",
  ratings: "product_ratings_v2"
};

function getBaseUrl(collection) { 
  return `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/${collection}`; 
}


