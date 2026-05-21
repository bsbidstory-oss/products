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

// Convert Firestore document format to a flat JS object
export function parseFirestoreDocument(doc) {
  if (!doc || !doc.fields) return null;
  
  const fields = doc.fields;
  const result = {};
  
  // Extract document ID from name
  const nameParts = doc.name.split('/');
  result.id = nameParts[nameParts.length - 1];
  
  for (const [key, value] of Object.entries(fields)) {
    if ('stringValue' in value) {
      result[key] = value.stringValue;
    } else if ('integerValue' in value) {
      result[key] = parseInt(value.integerValue, 10);
    } else if ('doubleValue' in value) {
      result[key] = parseFloat(value.doubleValue);
    } else if ('booleanValue' in value) {
      result[key] = value.booleanValue;
    } else if ('nullValue' in value) {
      result[key] = null;
    } else {
      result[key] = value;
    }
  }
  return result;
}

// Convert standard JS object to Firestore document format
export function toFirestoreDocument(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    // Skip fields we don't want to save as document properties, like the parsed client-side ID
    if (key === 'id' && obj.product_key) continue;

    if (value === null || value === undefined) {
      fields[key] = { nullValue: null };
    } else if (typeof value === 'boolean') {
      fields[key] = { booleanValue: value };
    } else if (key === 'MainCategory' || key === 'SubCategory' || key === 'ImageIndex' || key === 'product_quantity' || key === 'serviceType' || key === 'is_approved') {
      // Force specific fields to be saved as integer values
      fields[key] = { integerValue: String(Math.round(Number(value))) };
    } else if (typeof value === 'number') {
      fields[key] = { doubleValue: value };
    } else {
      fields[key] = { stringValue: String(value) };
    }
  }
  return { fields };
}

// API Operation: Fetch all products from Firestore
export async function getProducts() {
  const url = `${getBaseUrl(COLLECTIONS.products)}?key=${firebaseConfig.apiKey}&pageSize=300`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    if (!data.documents) return [];
    return data.documents.map(parseFirestoreDocument).filter(Boolean);
  } catch (err) {
    console.error("Error fetching products:", err);
    throw err;
  }
}

// API Operation: Save (Create or Update) product in Firestore
export async function saveProduct(productData) {
  const docId = productData.product_key;
  if (!docId) throw new Error("Product key is required to save document");
  
  const url = `${getBaseUrl(COLLECTIONS.products)}/${docId}?key=${firebaseConfig.apiKey}`;
  const firestoreDoc = toFirestoreDocument(productData);
  
  try {
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(firestoreDoc)
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    return parseFirestoreDocument(data);
  } catch (err) {
    console.error("Error saving product:", err);
    throw err;
  }
}

// API Operation: Delete product from Firestore
export async function deleteProduct(productKey) {
  if (!productKey) throw new Error("Product key is required to delete document");
  const url = `${getBaseUrl(COLLECTIONS.products)}/${productKey}?key=${firebaseConfig.apiKey}`;
  
  try {
    const response = await fetch(url, {
      method: "DELETE"
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return true;
  } catch (err) {
    console.error("Error deleting product:", err);
    throw err;
  }
}

// API Operation: Fetch all ratings from Firestore for a specific product
export async function getProductRatings(productKey) {
  if (!productKey) return [];
  
  // Use runQuery for highly efficient filtering
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents:runQuery?key=${firebaseConfig.apiKey}`;
  const queryBody = {
    structuredQuery: {
      from: [{ collectionId: COLLECTIONS.ratings }],
      where: {
        fieldFilter: {
          field: { fieldPath: "product_key" },
          op: "EQUAL",
          value: { stringValue: productKey }
        }
      }
    }
  };

  try {
    const response = await fetch(queryUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(queryBody)
    });
    
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const results = await response.json();
    
    // Firestore returns a list of results, each having a "document" field
    return results
      .filter(item => item.document)
      .map(item => parseFirestoreDocument(item.document))
      .filter(Boolean);
  } catch (err) {
    console.error(`Error fetching ratings for product ${productKey}:`, err);
    // Fallback: fetch all and filter client side
    try {
      const fallbackUrl = `${getBaseUrl(COLLECTIONS.ratings)}?key=${firebaseConfig.apiKey}&pageSize=300`;
      const fallbackResponse = await fetch(fallbackUrl);
      if (!fallbackResponse.ok) return [];
      const fallbackData = await fallbackResponse.json();
      if (!fallbackData.documents) return [];
      return fallbackData.documents
        .map(parseFirestoreDocument)
        .filter(doc => doc && doc.product_key === productKey);
    } catch (fallbackErr) {
      console.error("Fallback ratings fetch failed:", fallbackErr);
      return [];
    }
  }
}

// API Operation: Save a new product rating in Firestore
export async function addProductRating(ratingData) {
  // Generate a random unique ID for the rating if not provided
  const ratingId = ratingData.id || `rating_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const url = `${getBaseUrl(COLLECTIONS.ratings)}/${ratingId}?key=${firebaseConfig.apiKey}`;
  
  const enrichedData = {
    ...ratingData,
    id: ratingId,
    created_at: ratingData.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  const firestoreDoc = toFirestoreDocument(enrichedData);
  
  try {
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(firestoreDoc)
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    return parseFirestoreDocument(data);
  } catch (err) {
    console.error("Error adding product rating:", err);
    throw err;
  }
}
