/**
 * Classroom Technology Observer
 *
 * Backend for a small Google Apps Script web app. The app stores observations
 * in a Google Sheet that is created automatically on first setup.
 */

const APP = {
  TITLE: 'Classroom Technology Observer',
  SHEET_NAME: 'Observations',
  PROPERTY_KEY: 'DATA_SPREADSHEET_ID',
  ROLES: ['Professor', 'Student', 'TA'],
  OTHER_MAX: 100,
  TOOL_MAX: 100,
  USE_CASE_MAX: 500,
};

/** Serve the web app. */
function doGet() {
  return HtmlService
    .createHtmlOutputFromFile('Index')
    .setTitle(APP.TITLE)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * One-time setup. Run this manually from the Apps Script editor.
 * It creates the backing spreadsheet if one does not already exist.
 */
function setup() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    let spreadsheetId = props.getProperty(APP.PROPERTY_KEY);

    if (!spreadsheetId) {
      const spreadsheet = SpreadsheetApp.create(APP.TITLE + ' Data');
      spreadsheetId = spreadsheet.getId();
      props.setProperty(APP.PROPERTY_KEY, spreadsheetId);
    }

    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    let sheet = spreadsheet.getSheetByName(APP.SHEET_NAME);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(APP.SHEET_NAME);
    }

    initializeSheet_(sheet);

    console.log('Data spreadsheet: ' + spreadsheet.getUrl());
    return {
      spreadsheetId: spreadsheetId,
      spreadsheetUrl: spreadsheet.getUrl(),
    };
  } finally {
    lock.releaseLock();
  }
}

/** Return lightweight information used by the page. */
function getAppState() {
  const sheet = getDataSheet_();
  const lastRow = sheet.getLastRow();
  return {
    count: Math.max(0, lastRow - 1),
  };
}

/**
 * Return observations for the read-only browse page. The duplicate key is
 * intentionally omitted so the browser only receives display data.
 */
function getObservations() {
  const sheet = getDataSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  return values.map(function(row) {
    return {
      id: String(row[0] || ''),
      timestamp: row[1] instanceof Date ? row[1].toISOString() : String(row[1] || ''),
      tool: String(row[2] || ''),
      usedBy: String(row[3] || ''),
      useCase: String(row[4] || ''),
    };
  }).reverse();
}

/**
 * Validate, duplicate-check, and save one observation.
 * @param {{tool:string, roles:string[], otherRole:string, useCase:string}} submission
 */
function submitObservation(submission) {
  if (!submission || typeof submission !== 'object') {
    throw new Error('Please complete the form.');
  }

  const tool = cleanInput_(submission.tool, APP.TOOL_MAX, 'Tool name');
  const roles = Array.isArray(submission.roles) ? submission.roles.map(value => String(value).trim()).filter(Boolean) : [];
  const otherRole = String(submission.otherRole || '').trim();
  const useCase = cleanInput_(submission.useCase, APP.USE_CASE_MAX, 'Example use case');

  const validRoles = roles.filter(role => APP.ROLES.includes(role));
  const hasOther = roles.includes('Other');
  const hasInvalidRole = roles.some(role => role !== 'Other' && !APP.ROLES.includes(role));

  if (!roles.length || hasInvalidRole || validRoles.length !== new Set(validRoles).size) {
    throw new Error('Please choose at least one valid user type.');
  }

  if (hasOther) {
    if (!otherRole) {
      throw new Error('Please describe who uses the tool when you choose Other.');
    }
    if (otherRole.length > APP.OTHER_MAX) {
      throw new Error('The Other user type is too long.');
    }
  } else if (otherRole) {
    throw new Error('Please choose Other before entering a custom user type.');
  }

  const selectedUsers = [
    ...APP.ROLES.filter(role => validRoles.includes(role)),
    ...(hasOther ? ['Other: ' + otherRole] : []),
  ];

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = getDataSheet_();
    const lastRow = sheet.getLastRow();

    // Read the current Sheet values rather than relying on a stored duplicate key.
    // This keeps duplicate detection accurate even after a Sheet editor changes a row.
    const duplicateKey = [tool, selectedUsers.join(', '), useCase]
      .map(normalizeForDuplicate_)
      .join('|');

    if (lastRow > 1) {
      const existingRows = sheet.getRange(2, 3, lastRow - 1, 3).getValues();
      const duplicateFound = existingRows.some(function(row) {
        const existingKey = [row[0], row[1], row[2]]
          .map(normalizeForDuplicate_)
          .join('|');
        return existingKey === duplicateKey;
      });

      if (duplicateFound) {
        return {
          ok: false,
          duplicate: true,
          message: 'That exact observation is already in the collection, so it was not added again.',
          count: lastRow - 1,
        };
      }
    }

    const id = Utilities.getUuid().slice(0, 8).toUpperCase();
    sheet.appendRow([
      id,
      new Date(),
      tool,
      selectedUsers.join(', '),
      useCase,
      duplicateKey,
    ]);

    return {
      ok: true,
      duplicate: false,
      id: id,
      count: sheet.getLastRow() - 1,
      message: 'Observation added.',
    };
  } finally {
    lock.releaseLock();
  }
}

/** Get/create the backing data sheet. */
function getDataSheet_() {
  const props = PropertiesService.getScriptProperties();
  let spreadsheetId = props.getProperty(APP.PROPERTY_KEY);

  if (!spreadsheetId) {
    setup();
    spreadsheetId = props.getProperty(APP.PROPERTY_KEY);
  }

  if (!spreadsheetId) {
    throw new Error('The data spreadsheet could not be initialized. Run setup() once in the Apps Script editor.');
  }

  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  let sheet = spreadsheet.getSheetByName(APP.SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(APP.SHEET_NAME);
  }

  initializeSheet_(sheet);
  return sheet;
}

/** Set up the sheet header and useful formatting. */
function initializeSheet_(sheet) {
  const headers = ['ID', 'Timestamp', 'Tool', 'Used By', 'Example Use Case', 'Duplicate Key'];
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  const current = headerRange.getValues()[0];

  if (current.every(value => value === '')) {
    headerRange.setValues([headers]);
  }

  if (sheet.getFrozenRows() === 0) {
    sheet.setFrozenRows(1);
  }

  headerRange.setFontWeight('bold');
  sheet.getRange('B:B').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.hideColumns(6);
  sheet.autoResizeColumns(1, 5);
}

/** Basic trimming and length validation. */
function cleanInput_(value, maxLength, label) {
  const cleaned = String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  if (!cleaned) {
    throw new Error(label + ' is required.');
  }
  if (cleaned.length > maxLength) {
    throw new Error(label + ' is too long.');
  }
  return cleaned;
}

/** Normalize only enough to catch accidental exact duplicates. */
function normalizeForDuplicate_(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[“”"']/g, '')
    .replace(/[.,!?;:]+/g, '')
    .replace(/\s+/g, ' ');
}
