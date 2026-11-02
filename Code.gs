/**
 * Classroom Technology Observer
 *
 * Backend for a small Google Apps Script web app. The app stores observations
 * in a Google Sheet that is created automatically on first setup.
 */

const APP = {
  TITLE: 'Classroom Technology Observer',
  SHEET_NAME: 'Individual Tools',
  LEGACY_SHEET_NAME: 'Observations',
  CLASS_SHEET_NAME: 'Class Structures',
  PROPERTY_KEY: 'DATA_SPREADSHEET_ID',
  ROLES: ['Professor', 'Student', 'TA'],
  OTHER_MAX: 100,
  TOOL_MAX: 100,
  USE_CASE_MAX: 500,
  NOTES_MAX: 500,
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
    const sheet = getNamedSheet_(spreadsheet, APP.SHEET_NAME, APP.LEGACY_SHEET_NAME);

    initializeSheet_(sheet);

    let classSheet = spreadsheet.getSheetByName(APP.CLASS_SHEET_NAME);
    if (!classSheet) {
      classSheet = spreadsheet.insertSheet(APP.CLASS_SHEET_NAME);
    }
    initializeClassSheet_(classSheet);

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
  const toolCount = Math.max(0, getDataSheet_().getLastRow() - 1);
  const classCount = Math.max(0, getClassSheet_().getLastRow() - 1);
  return {
    count: toolCount + classCount,
    toolCount: toolCount,
    classCount: classCount,
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

  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    .map(function(header) { return String(header || ''); });
  const notesIndex = headers.indexOf('Anything Else');
  const hasNotesColumn = notesIndex !== -1;
  const numColumns = Math.max(lastColumn, hasNotesColumn ? notesIndex + 1 : 5);

  const values = sheet.getRange(2, 1, lastRow - 1, numColumns).getValues();
  return values.map(function(row) {
    return {
      id: String(row[0] || ''),
      timestamp: row[1] instanceof Date ? row[1].toISOString() : String(row[1] || ''),
      tool: String(row[2] || ''),
      usedBy: String(row[3] || ''),
      useCase: String(row[4] || ''),
      notes: hasNotesColumn ? String(row[notesIndex] || '') : '',
    };
  }).reverse();
}

/**
 * Validate, duplicate-check, and save one observation.
 * @param {{tool:string, roles:string[], otherRole:string, useCase:string, notes:string}} submission
 */
function submitObservation(submission) {
  if (!submission || typeof submission !== 'object') {
    throw new Error('Please complete the form.');
  }

  const tool = cleanInput_(submission.tool, APP.TOOL_MAX, 'Tool name');
  const roles = Array.isArray(submission.roles) ? submission.roles.map(value => String(value).trim()).filter(Boolean) : [];
  const otherRole = String(submission.otherRole || '').trim();
  const useCase = cleanInput_(submission.useCase, APP.USE_CASE_MAX, 'Example use case');
  const notes = cleanOptionalInput_(submission.notes, APP.NOTES_MAX, 'Anything else');

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
          toolCount: lastRow - 1,
          classCount: Math.max(0, getClassSheet_().getLastRow() - 1),
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
      notes,
      duplicateKey,
    ]);

    const toolCount = sheet.getLastRow() - 1;
    const classCount = Math.max(0, getClassSheet_().getLastRow() - 1);
    return {
      ok: true,
      duplicate: false,
      id: id,
      count: toolCount,
      toolCount: toolCount,
      classCount: classCount,
      message: 'Observation added.',
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Save one class-structure rating to the Class Structures tab.
 * The same rating can be saved more than once, because each submission is a separate class.
 * @param {{courseCode:string, courseTitle:string, rating:number|string}} submission
 */
function submitClassStructure(submission) {
  if (!submission || typeof submission !== 'object') {
    throw new Error('Please complete the class structure form.');
  }

  const courseCode = cleanFreeText_(submission.courseCode);
  const courseTitle = cleanFreeText_(submission.courseTitle);
  const rating = cleanRating_(submission.rating);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = getClassSheet_();
    const id = Utilities.getUuid().slice(0, 8).toUpperCase();
    sheet.appendRow([id, new Date(), courseCode, courseTitle, rating]);

    const classCount = sheet.getLastRow() - 1;
    const toolCount = Math.max(0, getDataSheet_().getLastRow() - 1);
    return {
      ok: true,
      id: id,
      rating: rating,
      count: classCount,
      toolCount: toolCount,
      classCount: classCount,
      message: 'Observation added.',
    };
  } finally {
    lock.releaseLock();
  }
}

/** Return class-structure observations for the browse page. */
function getClassStructures() {
  const sheet = getClassSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) return [];

  const lastColumn = Math.max(sheet.getLastColumn(), 5);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    .map(function(header) { return String(header || ''); });
  const codeIndex = headers.indexOf('Course Code');
  const titleIndex = headers.indexOf('Course Title');
  const ratingIndex = headers.indexOf('Class Structure');
  const values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  return values.map(function(row) {
    const ratingCell = ratingIndex === -1 ? row[2] : row[ratingIndex];
    return {
      id: String(row[0] || ''),
      timestamp: row[1] instanceof Date ? row[1].toISOString() : String(row[1] || ''),
      courseCode: codeIndex === -1 ? '' : String(row[codeIndex] || ''),
      courseTitle: titleIndex === -1 ? '' : String(row[titleIndex] || ''),
      rating: String(ratingCell || ''),
    };
  }).reverse();
}

/** Open the spreadsheet created by setup(). */
function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  let spreadsheetId = props.getProperty(APP.PROPERTY_KEY);

  if (!spreadsheetId) {
    setup();
    spreadsheetId = props.getProperty(APP.PROPERTY_KEY);
  }

  if (!spreadsheetId) {
    throw new Error('The data spreadsheet could not be initialized. Run setup() once in the Apps Script editor.');
  }

  return SpreadsheetApp.openById(spreadsheetId);
}

/** Get/create the individual-tool sheet. */
function getDataSheet_() {
  const sheet = getNamedSheet_(getSpreadsheet_(), APP.SHEET_NAME, APP.LEGACY_SHEET_NAME);
  initializeSheet_(sheet);
  return sheet;
}

/**
 * Return a sheet by name, renaming a previous tab when one is supplied.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {string} name
 * @param {string=} legacyName
 */
function getNamedSheet_(spreadsheet, name, legacyName) {
  let sheet = spreadsheet.getSheetByName(name);
  if (sheet) return sheet;

  if (legacyName) {
    const legacy = spreadsheet.getSheetByName(legacyName);
    if (legacy) {
      legacy.setName(name);
      return legacy;
    }
  }

  return spreadsheet.insertSheet(name);
}

/** Get/create the class-structure sheet in the same spreadsheet. */
function getClassSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(APP.CLASS_SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(APP.CLASS_SHEET_NAME);
  }

  initializeClassSheet_(sheet);
  return sheet;
}

/** Set up the sheet header and useful formatting. */
function initializeSheet_(sheet) {
  const headers = ['ID', 'Timestamp', 'Tool', 'Used By', 'Example Use Case', 'Anything Else', 'Duplicate Key'];
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const current = sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    .map(function(value) { return String(value || ''); });

  const isEmpty = current.every(function(value) { return value === ''; });
  const isOldLayout = !isEmpty &&
    current[0] === 'ID' &&
    current[1] === 'Timestamp' &&
    current[2] === 'Tool' &&
    current[3] === 'Used By' &&
    current[4] === 'Example Use Case' &&
    current[5] === 'Duplicate Key' &&
    current[6] !== 'Duplicate Key';

  if (isEmpty) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else if (isOldLayout) {
    // Upgrade sheets created before the optional "Anything Else" column existed.
    // Move the stored duplicate keys from column F to column G so column F can
    // hold the new optional notes instead of exposing duplicate keys as notes.
    const lastRow = sheet.getLastRow();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (lastRow > 1) {
      const oldKeys = sheet.getRange(2, 6, lastRow - 1, 1).getValues();
      sheet.getRange(2, 7, lastRow - 1, 1).setValues(oldKeys);
      sheet.getRange(2, 6, lastRow - 1, 1).clearContent();
    }
  }

  const headerRange = sheet.getRange(1, 1, 1, headers.length);

  if (sheet.getFrozenRows() === 0) {
    sheet.setFrozenRows(1);
  }

  headerRange.setFontWeight('bold');
  sheet.getRange('B:B').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  if (sheet.showColumns) {
    sheet.showColumns(6, 1);
  }
  sheet.hideColumns(7);
  sheet.autoResizeColumns(1, 6);
}

/** Set up the class-structure sheet header and formatting. */
function initializeClassSheet_(sheet) {
  const headers = ['ID', 'Timestamp', 'Course Code', 'Course Title', 'Class Structure'];
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const current = sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    .map(function(value) { return String(value || ''); });
  const isEmpty = current.every(function(value) { return value === ''; });
  const isOldLayout = !isEmpty &&
    current[0] === 'ID' &&
    current[1] === 'Timestamp' &&
    current[2] === 'Class Structure' &&
    current[3] !== 'Course Title';

  if (isEmpty) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else if (isOldLayout) {
    const lastRow = sheet.getLastRow();
    const ratings = lastRow > 1 ? sheet.getRange(2, 3, lastRow - 1, 1).getValues() : [];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (lastRow > 1) {
      sheet.getRange(2, 5, lastRow - 1, 1).setValues(ratings);
      sheet.getRange(2, 3, lastRow - 1, 2).clearContent();
    }
  }

  const headerRange = sheet.getRange(1, 1, 1, headers.length);

  if (sheet.getFrozenRows() === 0) {
    sheet.setFrozenRows(1);
  }

  headerRange.setFontWeight('bold');
  sheet.getRange('B:B').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.autoResizeColumns(1, headers.length);
}

/** Trim free-text course fields without enforcing a format yet. */
function cleanFreeText_(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
}

/** Accept one of the five class-structure titles. Older numeric values are converted. */
function cleanRating_(value) {
  const structures = [
    'Tech as a vehicle',
    'Tech as supporting experience',
    'Tech and content intertwined',
    'Content as context for tech',
    'Tech as the learning goal',
  ];
  const text = String(value == null ? '' : value).trim();
  if (structures.indexOf(text) !== -1) return text;

  const rating = Number(text);
  if (Number.isInteger(rating) && rating >= 1 && rating <= structures.length) {
    return structures[rating - 1];
  }
  throw new Error('Please choose a class structure.');
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

/** Trim optional input, enforce max length, and return '' when empty. */
function cleanOptionalInput_(value, maxLength, label) {
  const cleaned = String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  if (!cleaned) {
    return '';
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
