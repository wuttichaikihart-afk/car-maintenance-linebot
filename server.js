const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to parse raw body for LINE webhook
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Helper to adapt Express req/res to Netlify function signature
const runNetlifyFunction = async (handler, req, res) => {
  const event = {
    httpMethod: req.method,
    headers: req.headers,
    body: req.method === 'GET' ? null : (req.rawBody || JSON.stringify(req.body)),
    queryStringParameters: req.query,
  };

  try {
    const response = await handler(event, {});
    if (response.headers) {
      for (const [key, value] of Object.entries(response.headers)) {
        res.setHeader(key, value);
      }
    }
    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Function error:', error);
    res.status(500).send('Internal Server Error');
  }
};

// Routes
const webhookHandler = require('./netlify/functions/webhook').handler;
const apiRegisterHandler = require('./netlify/functions/api-register').handler;

app.post('/.netlify/functions/webhook', (req, res) => runNetlifyFunction(webhookHandler, req, res));
app.post('/.netlify/functions/api-register', (req, res) => runNetlifyFunction(apiRegisterHandler, req, res));

// Also map to shorter URLs for future use
app.post('/webhook', (req, res) => runNetlifyFunction(webhookHandler, req, res));
app.post('/api/register', (req, res) => runNetlifyFunction(apiRegisterHandler, req, res));

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
