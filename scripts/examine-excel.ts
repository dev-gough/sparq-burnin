#!/usr/bin/env tsx

import * as XLSX from 'xlsx';

const workbook = XLSX.readFile('./Burnin Failure Overview.xlsx');
const worksheet = workbook.Sheets['Failures'];

// Convert to JSON
const data = XLSX.utils.sheet_to_json(worksheet, { defval: null, raw: false });

console.log('Total Rows:', data.length);
console.log('\n========== SAMPLE DATA (Rows 1-10) ==========\n');

data.slice(0, 10).forEach((row, idx) => {
  console.log('Row ' + (idx + 1) + ':');
  console.log('  Failure Date: "' + row['Failure Date'] + '"');
  console.log('  Failure Category: "' + row['Failure Category'] + '"');
  console.log('  Serial Number: "' + row['Serial Number'] + '"');
  console.log('  Additional Information: "' + row['Additional Information'] + '"');
  console.log('');
});

// Check unique failure categories
console.log('\n========== UNIQUE FAILURE CATEGORIES ==========\n');
const categories = new Set();
data.forEach(row => {
  if (row['Failure Category']) {
    categories.add(row['Failure Category']);
  }
});

Array.from(categories).sort().forEach(cat => {
  console.log('  - ' + cat);
});

console.log('\n========== DATE FORMAT SAMPLES ==========\n');
const dates = new Set();
data.slice(0, 20).forEach(row => {
  if (row['Failure Date']) {
    dates.add(row['Failure Date']);
  }
});

Array.from(dates).forEach(date => {
  console.log('  ' + date);
});
