require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const authRouter = require('./routes/auth');
const apiRouter = require('./routes/api');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'echospark-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/auth', authRouter);
app.use('/api', apiRouter);

// SPA fallback — serve index.html for all other routes
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`EchoSpark running at http://localhost:${port}`);
  console.log(`Demo mode: visit http://localhost:${port} (no login required)`);
});
