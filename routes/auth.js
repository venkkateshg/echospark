const express = require('express');
const router = express.Router();
const { getAuthCodeUrl, acquireTokenByCode, createGraphClient, DEFAULT_SCOPES } = require('../graphClient');

const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/auth/callback';

// GET /auth/login
router.get('/login', async (req, res) => {
  try {
    const authUrl = await getAuthCodeUrl(REDIRECT_URI, DEFAULT_SCOPES);
    res.redirect(authUrl);
  } catch (error) {
    console.error('[auth] /login error:', error.message || error);
    res.status(500).json({ error: 'Failed to generate sign-in URL' });
  }
});

// GET /auth/callback
router.get('/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    const tokenResponse = await acquireTokenByCode(code, REDIRECT_URI, DEFAULT_SCOPES);
    const accessToken = tokenResponse.accessToken;
    req.session.accessToken = accessToken;

    // Attempt to fetch the user's display name from Graph /me
    try {
      const graphClient = createGraphClient(accessToken);
      const me = await graphClient.api('/me').select('displayName').get();
      req.session.userDisplayName = (me && me.displayName) ? me.displayName : 'Creator';
    } catch (meError) {
      console.warn('[auth] /me fetch failed, using fallback name:', meError.message || meError);
      req.session.userDisplayName = 'Creator';
    }

    res.redirect('/');
  } catch (error) {
    console.error('[auth] /callback error:', error.message || error);
    res.status(500).json({ error: 'Failed to acquire token' });
  }
});

// GET /auth/logout
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;
