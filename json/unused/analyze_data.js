// Script to analyze the email and first_name discrepancy
import fs from 'fs';

// Read the file
const content = fs.readFileSync('c:\\Users\\charl\\Documents\\Projects\\Commisions\\Xulon Press\\json\\unformattedEventMessage.js', 'utf8');

// Split into lines and filter for relevant ones
const lines = content.split('\n');

// Multiple patterns for emails
const emailPattern1 = /email\s*:\s*[^,\s]+/g;
const emailPattern2 = /email\s*:\s*[^,]+/g; 
const emailPattern3 = /@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g; // Any email format

const emails1 = content.match(emailPattern1) || [];
const emails2 = content.match(emailPattern2) || [];
const emails3 = content.match(emailPattern3) || [];

console.log(`Email pattern 1 (no spaces): ${emails1.length}`);
console.log(`Email pattern 2 (with spaces): ${emails2.length}`);
console.log(`Email pattern 3 (any @ format): ${emails3.length}`);

// Count first_names with different patterns
const firstNamePattern1 = /first_name\s*:\s*[^,]+/g;
const firstNamePattern2 = /first_name\s*:\s*[^,\}]+/g;

const firstNames1 = content.match(firstNamePattern1) || [];
const firstNames2 = content.match(firstNamePattern2) || [];

console.log(`First name pattern 1: ${firstNames1.length}`);
console.log(`First name pattern 2: ${firstNames2.length}`);

// Let's also check for any lines that contain 'email' but might not match our pattern
const linesWithEmail = lines.filter(line => line.toLowerCase().includes('email'));
console.log(`Lines containing 'email': ${linesWithEmail.length}`);

// Check if there are any malformed records
console.log('\nFirst few email matches:');
emails2.slice(0, 5).forEach((email, i) => {
    console.log(`${i+1}: ${email}`);
});

console.log('\nFirst few first_name matches:');
firstNames1.slice(0, 5).forEach((name, i) => {
    console.log(`${i+1}: ${name}`);
});

// Look for records that might have missing first_name specifically
const recordBlocks = content.split(/\s*{\s*/);
let recordsWithEmailButNoFirstName = 0;
let recordsWithEmailAndFirstName = 0;

recordBlocks.forEach((block, index) => {
    if (block.includes('email')) {
        if (!block.includes('first_name')) {
            recordsWithEmailButNoFirstName++;
            console.log(`\nRecord ${index} missing first_name:`);
            console.log(block.substring(0, 200));
        } else {
            recordsWithEmailAndFirstName++;
        }
    }
});

console.log(`\nFinal count:`);
console.log(`Records with email AND first_name: ${recordsWithEmailAndFirstName}`);
console.log(`Records with email but NO first_name: ${recordsWithEmailButNoFirstName}`);
console.log(`Total records with email: ${recordsWithEmailAndFirstName + recordsWithEmailButNoFirstName}`);