import { Client } from 'pg';
import { getDatabaseConfig } from '../src/lib/config';

const dbConfig = getDatabaseConfig();

async function migrateAnnotations() {
  console.log('Database config:', {
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user
  });

  const client = new Client(dbConfig);
  let connected = false;

  try {
    console.log('\nConnecting to database...');
    await client.connect();
    connected = true;
    console.log('✓ Connected to database');

    // Test connection
    const testResult = await client.query('SELECT NOW()');
    console.log('✓ Database connection verified');

    // Start transaction
    await client.query('BEGIN');
    console.log('✓ Transaction started');

    // ===================================================================
    // 1. Combine "Grid" and "Grid Issue" into "Unstable Grid"
    // ===================================================================
    console.log('\n1. Combining "Grid" and "Grid Issue" into "Unstable Grid"...');

    // Update all test annotations from "Grid" to "Unstable Grid"
    const gridResult = await client.query(`
      UPDATE TestAnnotations
      SET annotation_text = 'Unstable Grid'
      WHERE annotation_text = 'Grid'
    `);
    console.log(`   Updated ${gridResult.rowCount} annotations from "Grid" to "Unstable Grid"`);

    // Update all test annotations from "Grid Issue" to "Unstable Grid"
    const gridIssueResult = await client.query(`
      UPDATE TestAnnotations
      SET annotation_text = 'Unstable Grid'
      WHERE annotation_text = 'Grid Issue'
    `);
    console.log(`   Updated ${gridIssueResult.rowCount} annotations from "Grid Issue" to "Unstable Grid"`);

    // Delete old quick options
    await client.query(`DELETE FROM AnnotationQuickOptions WHERE option_text = 'Grid'`);
    console.log('   Deleted "Grid" quick option');

    await client.query(`DELETE FROM AnnotationQuickOptions WHERE option_text = 'Grid Issue'`);
    console.log('   Deleted "Grid Issue" quick option');

    // Create new "Unstable Grid" quick option in "Setup Issue" group
    await client.query(`
      INSERT INTO AnnotationQuickOptions (option_text, group_name, display_order)
      VALUES ('Unstable Grid', 'Setup Issue', 999)
      ON CONFLICT (option_text) DO NOTHING
    `);
    console.log('   Created "Unstable Grid" quick option in "Setup Issue" group');

    // ===================================================================
    // 2. Merge "Channel Undervoltage" into "Channel Short"
    // ===================================================================
    console.log('\n2. Merging "Channel Undervoltage" into "Channel Short"...');

    // Merge BA version (both with and without parentheses)
    const baUnderResult = await client.query(`
      UPDATE TestAnnotations
      SET annotation_text = 'Channel Short BA'
      WHERE annotation_text IN ('Channel Undervoltage (BA)', 'Channel Undervoltage BA')
    `);
    console.log(`   Merged ${baUnderResult.rowCount} "Channel Undervoltage BA" into "Channel Short BA"`);

    // Merge AA version (both with and without parentheses)
    const aaUnderResult = await client.query(`
      UPDATE TestAnnotations
      SET annotation_text = 'Channel Short AA'
      WHERE annotation_text IN ('Channel Undervoltage (AA)', 'Channel Undervoltage AA')
    `);
    console.log(`   Merged ${aaUnderResult.rowCount} "Channel Undervoltage AA" into "Channel Short AA"`);

    // Delete old quick options
    await client.query(`DELETE FROM AnnotationQuickOptions WHERE option_text LIKE 'Channel Undervoltage%'`);
    console.log('   Deleted "Channel Undervoltage" quick options');

    // ===================================================================
    // 3. Rename "Channel Short" to full names
    // ===================================================================
    console.log('\n3. Renaming "Channel Short" to full names...');

    // Rename BA version (both with and without parentheses)
    const baRenameAnnotations = await client.query(`
      UPDATE TestAnnotations
      SET annotation_text = 'Channel Short Before Aging'
      WHERE annotation_text IN ('Channel Short (BA)', 'Channel Short BA')
    `);
    console.log(`   Renamed ${baRenameAnnotations.rowCount} annotations to "Channel Short Before Aging"`);

    const baRenameOption = await client.query(`
      UPDATE AnnotationQuickOptions
      SET option_text = 'Channel Short Before Aging'
      WHERE option_text IN ('Channel Short (BA)', 'Channel Short BA')
    `);
    console.log(`   Renamed ${baRenameOption.rowCount} quick option(s) to "Channel Short Before Aging"`);

    // Rename AA version (both with and without parentheses)
    const aaRenameAnnotations = await client.query(`
      UPDATE TestAnnotations
      SET annotation_text = 'Channel Short During Aging'
      WHERE annotation_text IN ('Channel Short (AA)', 'Channel Short AA')
    `);
    console.log(`   Renamed ${aaRenameAnnotations.rowCount} annotations to "Channel Short During Aging"`);

    const aaRenameOption = await client.query(`
      UPDATE AnnotationQuickOptions
      SET option_text = 'Channel Short During Aging'
      WHERE option_text IN ('Channel Short (AA)', 'Channel Short AA')
    `);
    console.log(`   Renamed ${aaRenameOption.rowCount} quick option(s) to "Channel Short During Aging"`);

    // Commit transaction
    await client.query('COMMIT');
    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    if (connected) {
      try {
        await client.query('ROLLBACK');
        console.log('Rolled back transaction');
      } catch (rollbackError) {
        console.error('Error during rollback:', rollbackError);
      }
    }
    throw error;
  } finally {
    if (connected) {
      try {
        await client.end();
        console.log('Connection closed');
      } catch (closeError) {
        console.error('Error closing connection:', closeError);
      }
    }
  }
}

// Run migration
migrateAnnotations()
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration error:', error);
    process.exit(1);
  });
