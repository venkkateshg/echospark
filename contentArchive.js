require('dotenv').config();

const { getWorkIQContentContext, getWorkIQCombinedContext } = require('./workiqClient');

const ONEDRIVE_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'text/plain', // .txt
];

/**
 * Strips HTML tags from a string, returning plain text.
 * Also collapses excessive whitespace.
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Fetches documents from OneDrive (root children) for .docx and .txt files.
 * Attempts to read text content for each file; falls back to empty string on error.
 * Limits to the 50 most recently modified files.
 *
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @returns {Promise<Array<{id, title, content, source, type, createdAt, modifiedAt, webUrl}>>}
 */
async function fetchOneDriveDocuments(graphClient) {
  try {
    // Search across all of OneDrive (not just root) for .docx and .txt files
    const [docxResponse, txtResponse] = await Promise.allSettled([
      graphClient
        .api("/me/drive/root/search(q='.docx')")
        .select('id,name,webUrl,createdDateTime,lastModifiedDateTime,file,size')
        .top(50)
        .get(),
      graphClient
        .api("/me/drive/root/search(q='.txt')")
        .select('id,name,webUrl,createdDateTime,lastModifiedDateTime,file,size')
        .top(25)
        .get(),
    ]);

    const docxItems = docxResponse.status === 'fulfilled' ? (docxResponse.value.value || []) : [];
    const txtItems  = txtResponse.status  === 'fulfilled' ? (txtResponse.value.value  || []) : [];

    // Deduplicate by id, filter to MIME types we can read
    const seen = new Set();
    const items = [...docxItems, ...txtItems].filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return item.file && ONEDRIVE_MIME_TYPES.includes(item.file.mimeType);
    });

    // Filter to only .docx and .txt by MIME type
    const docItems = items
      .sort((a, b) => new Date(b.lastModifiedDateTime) - new Date(a.lastModifiedDateTime))
      .slice(0, 50);

    const results = await Promise.all(
      docItems.map(async item => {
        let content = '';
        try {
          // Graph SDK returns raw response for content endpoint; use stream or buffer
          const contentResponse = await graphClient
            .api(`/me/drive/items/${item.id}/content`)
            .get();

          if (typeof contentResponse === 'string') {
            content = contentResponse;
          } else if (Buffer.isBuffer(contentResponse)) {
            content = contentResponse.toString('utf8');
          } else if (contentResponse && typeof contentResponse.text === 'function') {
            content = await contentResponse.text();
          }
          // .docx binary: content may be garbled — keep only if it looks like text
          if (item.file.mimeType !== 'text/plain') {
            const printable = (content.match(/[\x20-\x7E]/g) || []).length;
            if (printable / Math.max(content.length, 1) < 0.7) content = '';
          }
        } catch (err) {
          // File content unreadable or permissions issue — not fatal
          content = '';
        }

        return {
          id: item.id,
          title: item.name,
          content,
          source: 'onedrive',
          type: 'document',
          createdAt: item.createdDateTime,
          modifiedAt: item.lastModifiedDateTime,
          webUrl: item.webUrl || '',
        };
      })
    );

    return results;
  } catch (err) {
    console.error('[contentArchive] fetchOneDriveDocuments error:', err.message || err);
    return [];
  }
}

/**
 * Fetches OneNote pages, extracts plain text from their HTML content.
 * Limits to the 30 most recently modified pages.
 * Returns [] gracefully if the Notes.Read.All scope is unavailable.
 *
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @returns {Promise<Array<{id, title, content, source, type, createdAt, modifiedAt, webUrl}>>}
 */
async function fetchOneNotePages(graphClient) {
  try {
    const response = await graphClient
      .api('/me/onenote/pages')
      .select('id,title,createdDateTime,lastModifiedDateTime,links')
      .get();

    const pages = response.value || [];

    const recentPages = pages
      .sort((a, b) => new Date(b.lastModifiedDateTime) - new Date(a.lastModifiedDateTime))
      .slice(0, 30);

    const results = await Promise.all(
      recentPages.map(async page => {
        let content = '';
        try {
          const htmlContent = await graphClient
            .api(`/me/onenote/pages/${page.id}/content`)
            .query({ includeIDs: false })
            .get();

          if (typeof htmlContent === 'string') {
            content = stripHtml(htmlContent);
          } else if (Buffer.isBuffer(htmlContent)) {
            content = stripHtml(htmlContent.toString('utf8'));
          }
        } catch (err) {
          // Individual page content failure is non-fatal
          content = '';
        }

        return {
          id: page.id,
          title: page.title || '',
          content,
          source: 'onenote',
          type: 'note',
          createdAt: page.createdDateTime,
          modifiedAt: page.lastModifiedDateTime,
          webUrl: page.links?.oneNoteWebUrl?.href || '',
        };
      })
    );

    return results;
  } catch (err) {
    // 403/404 most likely means Notes.Read.All scope is absent — degrade silently
    const status = err.statusCode || (err.body && JSON.parse(err.body || '{}').error?.code);
    if (
      err.statusCode === 403 ||
      err.statusCode === 404 ||
      (err.message && err.message.includes('scope'))
    ) {
      console.warn('[contentArchive] OneNote scope unavailable, skipping:', err.message || err);
    } else {
      console.error('[contentArchive] fetchOneNotePages error:', err.message || err);
    }
    return [];
  }
}

/**
 * Parses Work IQ's natural language content response into structured content items.
 * Work IQ returns a numbered list of documents — we extract title + body for each.
 *
 * @param {string} text  Raw Work IQ response text
 * @returns {Array<{id, title, content, source, type, createdAt, modifiedAt, webUrl}>}
 */
function parseWorkIQContentResponse(text) {
  if (!text || typeof text !== 'string') return [];

  // Split on numbered list markers or markdown headings
  const sections = text.split(/\n(?=\d+[\.\)]\s|\*\*\d+|\#{1,3}\s)/);

  return sections
    .filter(s => s.trim().length > 30)
    .map((section, i) => {
      const lines = section.split('\n').map(l => l.trim()).filter(Boolean);
      const titleLine = lines[0].replace(/^[\d\.\)\*\#\s]+/, '').replace(/\*\*/g, '').trim();
      const title = titleLine || `Work IQ Document ${i + 1}`;
      const content = lines.slice(1).join(' ').replace(/\*\*/g, '').trim();

      // Try to detect source from content hints
      let source = 'workiq';
      const contentLower = content.toLowerCase();
      if (contentLower.includes('teams') || contentLower.includes('chat')) source = 'teams';
      else if (contentLower.includes('email') || contentLower.includes('outlook')) source = 'email';
      else if (contentLower.includes('onenote') || contentLower.includes('notebook')) source = 'onenote';
      else if (contentLower.includes('onedrive') || contentLower.includes('sharepoint')) source = 'onedrive';

      return {
        id: `workiq-${i}`,
        title,
        content,
        source,
        type: 'document',
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
        webUrl: '',
      };
    })
    .filter(item => item.content.length > 20);
}

/**
 * Fetches content items from Work IQ (M365 Copilot) — surfaces writing from
 * Teams, email drafts, SharePoint, and other sources not directly accessible
 * via standard Graph API file endpoints.
 *
 * @param {string} accessToken
 * @returns {Promise<Array<{id, title, content, source, type, createdAt, modifiedAt, webUrl}>>}
 */
async function fetchWorkIQContent(accessToken) {
  if (!accessToken) return [];
  try {
    const rawResponse = await getWorkIQContentContext(accessToken);
    const items = parseWorkIQContentResponse(rawResponse);
    console.log(`[contentArchive] Work IQ returned ${items.length} content items`);
    return items;
  } catch (err) {
    console.warn('[contentArchive] Work IQ content fetch failed (non-fatal):', err.message);
    return [];
  }
}

/**
 * Fetches and combines the full content archive from OneDrive, OneNote, and Work IQ.
 * All sources are fetched in parallel; failures in any are isolated.
 * Results are filtered to items with non-empty content, sorted by modifiedAt desc.
 *
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {string|null} [accessToken]  If provided, Work IQ is used as an additional source
 * @returns {Promise<Array<{id, title, content, source, type, createdAt, modifiedAt, webUrl}>>}
 */
async function getContentArchive(graphClient, accessToken = null) {
  const tasks = [
    fetchOneDriveDocuments(graphClient),
    fetchOneNotePages(graphClient),
  ];

  if (accessToken) {
    tasks.push(fetchWorkIQContent(accessToken));
  }

  const [driveResult, notesResult, workiqResult] = await Promise.allSettled(tasks);

  const driveItems  = driveResult.status  === 'fulfilled' ? driveResult.value  : [];
  const noteItems   = notesResult.status  === 'fulfilled' ? notesResult.value  : [];
  const workiqItems = workiqResult?.status === 'fulfilled' ? workiqResult.value : [];

  if (driveResult.status  === 'rejected') console.error('[contentArchive] OneDrive fetch rejected:', driveResult.reason);
  if (notesResult.status  === 'rejected') console.error('[contentArchive] OneNote fetch rejected:', notesResult.reason);
  if (workiqResult?.status === 'rejected') console.warn('[contentArchive] Work IQ fetch rejected:', workiqResult.reason);

  const combined = [...driveItems, ...noteItems, ...workiqItems]
    .map(item => ({
      ...item,
      content: (item.content && item.content.trim()) ? item.content : `[Document: ${item.title}]`,
    }))
    .filter(item => item.title && item.title.trim().length > 0)
    .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));

  console.log(
    `[contentArchive] archive: ${driveItems.length} OneDrive + ${noteItems.length} OneNote` +
    `${accessToken ? ` + ${workiqItems.length} WorkIQ` : ''} = ${combined.length} total items`
  );
  return combined;
}

module.exports = {
  getContentArchive,
  fetchOneDriveDocuments,
  fetchOneNotePages,
  fetchWorkIQContent,
  parseWorkIQContentResponse,
  stripHtml,
};
