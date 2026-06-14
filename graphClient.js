require('dotenv').config();
const msal = require('@azure/msal-node');
const { Client } = require('@microsoft/microsoft-graph-client');

const DEFAULT_SCOPES = [
  'openid',
  'profile',
  'offline_access',
  'User.Read',
  'Files.Read.All',
  'Notes.Read.All',
  'Sites.Read.All',
  'Mail.Read',
  'People.Read.All',
  'OnlineMeetingTranscript.Read.All',
  'Chat.Read',
  'ChannelMessage.Read.All',
  'ExternalItem.Read.All',
];

const msalConfig = {
  auth: {
    clientId: process.env.CLIENT_ID || '<YOUR_CLIENT_ID>',
    authority:
      process.env.AUTHORITY || `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
    clientSecret: process.env.CLIENT_SECRET || '<YOUR_CLIENT_SECRET>',
  },
};

const cca = new msal.ConfidentialClientApplication(msalConfig);

async function getAuthCodeUrl(redirectUri, scopes = DEFAULT_SCOPES) {
  const authCodeUrlParameters = {
    scopes,
    redirectUri,
  };

  return cca.getAuthCodeUrl(authCodeUrlParameters);
}

async function acquireTokenByCode(authCode, redirectUri, scopes = DEFAULT_SCOPES) {
  const tokenRequest = {
    code: authCode,
    scopes,
    redirectUri,
  };

  const response = await cca.acquireTokenByCode(tokenRequest);
  if (!response || !response.accessToken) {
    throw new Error('Failed to acquire access token from auth code');
  }

  return response;
}

function createGraphClient(accessToken) {
  return Client.init({
    authProvider: done => {
      done(null, accessToken);
    },
  });
}

async function authenticateAndGetGraphClient(authCode, redirectUri, scopes = DEFAULT_SCOPES) {
  const tokenResponse = await acquireTokenByCode(authCode, redirectUri, scopes);
  return createGraphClient(tokenResponse.accessToken);
}

module.exports = {
  getAuthCodeUrl,
  acquireTokenByCode,
  createGraphClient,
  authenticateAndGetGraphClient,
  DEFAULT_SCOPES,
};
