const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const PromoTracker = require('./tracker');

const app = express();
const tracker = new PromoTracker();

// Middleware
app.use(express.json());
app.use(express.static('web'));

// Multer setup for image uploads
const upload = multer({ dest: 'uploads/' });

// Routes

// Upload screenshot and extract promotions
app.post('/api/upload', upload.single('screenshot'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No screenshot provided' });
    }

    // Read image
    const imageBuffer = await fs.readFile(req.file.path);
    
    // Extract text using vision (placeholder - would use actual vision API)
    const extractedData = await extractPromotionsFromImage(imageBuffer);
    
    // Clean up temp file
    await fs.unlink(req.file.path);
    
    // Save to tracker
    for (const promo of extractedData) {
      tracker.addPromotion(promo);
    }
    
    res.json({
      success: true,
      extracted: extractedData.length,
      promotions: extractedData
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manual promotion entry
app.post('/api/promotions', (req, res) => {
  try {
    const promo = tracker.addPromotion(req.body);
    res.json({ success: true, promotion: promo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all promotions
app.get('/api/promotions', (req, res) => {
  const bookmaker = req.query.bookmaker;
  const promos = tracker.getActivePromotions(bookmaker);
  res.json(promos);
});

// Get +EV opportunities from promotions
app.get('/api/opportunities', async (req, res) => {
  try {
    const opportunities = await tracker.findOpportunities();
    res.json(opportunities);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/index.html'));
});

// Placeholder vision extraction
async function extractPromotionsFromImage(imageBuffer) {
  // In production, this would call a vision API
  // For now, return placeholder that manual entry is needed
  return [];
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🎯 Promo Scanner running on port ${PORT}`);
});

module.exports = app;
