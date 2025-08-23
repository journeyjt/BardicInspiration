/**
 * Simple test script for the ConfirmationDialog
 * Run this in browser console when module is loaded
 * 
 * Usage: 
 * 1. Open FoundryVTT with the module loaded
 * 2. Open browser console
 * 3. Run: testConfirmationDialog()
 */

async function testConfirmationDialog() {
  console.log('Testing ConfirmationDialog...');
  
  try {
    // Test using the UIHelper method (which should use the new dialog)
    console.log('Testing via UIHelper.confirmDialog...');
    
    const result = await game.modules.get('bardic-inspiration').api.UIHelper.confirmDialog(
      'Browser Test Dialog',
      'This is a test message to verify the dialog works correctly in the browser.',
      {
        yesLabel: 'Works!',
        noLabel: 'Broken',
        type: 'warning',
        icon: 'fas fa-vial'
      }
    );
    
    console.log('Dialog result:', result);
    
  } catch (error) {
    console.error('Dialog test failed:', error);
    console.error('Error stack:', error.stack);
  }
}

async function testDirectDialogCreation() {
  console.log('Testing direct ConfirmationDialog creation...');
  
  try {
    // Import the dialog directly
    const module = game.modules.get('bardic-inspiration');
    console.log('Module API:', module?.api);
    
    // Try to access the ConfirmationDialog class
    const { ConfirmationDialog } = await import('./dist/ConfirmationDialog-sD3IeDIQ.js');
    console.log('ConfirmationDialog class:', ConfirmationDialog);
    
    // Create instance manually
    const dialog = new ConfirmationDialog(
      'Direct Test',
      'Testing direct dialog creation',
      { type: 'info' }
    );
    
    console.log('Dialog instance created:', dialog);
    console.log('Dialog template:', dialog.template);
    console.log('Dialog options:', dialog.options);
    
    // Try to render
    await dialog.render(true);
    console.log('Dialog rendered successfully');
    
  } catch (error) {
    console.error('Direct test failed:', error);
    console.error('Error stack:', error.stack);
  }
}

// Export for use in console
window.testConfirmationDialog = testConfirmationDialog;
window.testDirectDialogCreation = testDirectDialogCreation;

console.log('Dialog test functions loaded. Run testConfirmationDialog() or testDirectDialogCreation() in console.');