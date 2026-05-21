import fs from 'fs';

const apiKey = "AIzaSyDvT5RWHn2VStZ8Iy5Abxx7ciztdDLvBDw";
const projectId = "products-ecbb1";
const collection = "marketplace_products";

const products = JSON.parse(fs.readFileSync('products_dump.json', 'utf8'));

function toFirestoreDocument(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      fields[key] = { nullValue: null };
    } else if (typeof value === 'boolean') {
      fields[key] = { booleanValue: value };
    } else if (key === 'id' || key === 'MainCategory' || key === 'SubCategory' || key === 'ImageIndex' || key === 'product_quantity' || key === 'serviceType' || key === 'is_approved') {
      // Ensure numeric integer fields are saved as integers
      fields[key] = { integerValue: String(Math.round(Number(value))) };
    } else if (typeof value === 'number') {
      fields[key] = { doubleValue: value };
    } else {
      fields[key] = { stringValue: String(value) };
    }
  }
  return { fields };
}

async function migrate() {
  console.log(`Starting migration of ${products.length} products to Firestore collection: ${collection}...`);
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const docId = product.product_key;
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}/${docId}?key=${apiKey}`;
    const firestoreDoc = toFirestoreDocument(product);

    try {
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(firestoreDoc)
      });

      if (response.ok) {
        successCount++;
        console.log(`[${i + 1}/${products.length}] Successfully migrated product: ${product.productName} (${docId})`);
      } else {
        failCount++;
        const errorText = await response.text();
        console.error(`[${i + 1}/${products.length}] Failed to migrate product: ${product.productName} (${docId}). Status: ${response.status}. Error: ${errorText}`);
      }
    } catch (err) {
      failCount++;
      console.error(`[${i + 1}/${products.length}] Network error migrating product: ${product.productName} (${docId}). Error: ${err.message}`);
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log('\n--- Migration Summary ---');
  console.log(`Total Products: ${products.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${failCount}`);
}

migrate();
