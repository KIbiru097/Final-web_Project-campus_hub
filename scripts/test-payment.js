const { paymentService } = require('../src/services/payment.service');
const db = require('../src/config/database');

async function testMockPayments() {
  console.log('Testing Mock Payment System...\n');
  
  // Test Chapa payment
  console.log('1. Testing Chapa Payment:');
  const chapaResult = await paymentService.initiatePayment(
    'PRODUCT',
    'test-order-1',
    'CHAPA',
    'test-user-1'
  );
  console.log('   Result:', chapaResult.result);
  console.log('   Reference:', chapaResult.reference);
  console.log('');
  
  // Test TeleBirr payment
  console.log('2. Testing TeleBirr Payment:');
  const telebirrResult = await paymentService.initiatePayment(
    'PRODUCT',
    'test-order-2',
    'TELEBIRR',
    'test-user-1'
  );
  console.log('   Result:', telebirrResult.result);
  console.log('');
  
  // Test Cash payment
  console.log('3. Testing Cash Payment:');
  const cashResult = await paymentService.initiatePayment(
    'FOOD',
    'test-order-3',
    'CASH',
    'test-user-1'
  );
  console.log('   Result:', cashResult.result);
  console.log('');
  
  // Test Bank Transfer
  console.log('4. Testing Bank Transfer:');
  const bankResult = await paymentService.initiatePayment(
    'SERVICE',
    'test-order-4',
    'BANK_TRANSFER',
    'test-user-1'
  );
  console.log('   Result:', bankResult.result);
  if (bankResult.result.bankDetails) {
    console.log('   Bank Details:', bankResult.result.bankDetails);
  }
  console.log('');
  
  // Test refund
  console.log('5. Testing Refund:');
  const refundResult = await paymentService.processRefund(
    'test-payment-id',
    100,
    'Customer requested refund'
  );
  console.log('   Refund Result:', refundResult);
  
  console.log('\n✅ Mock payment tests completed!');
}

testMockPayments().catch(console.error).finally(() => {
  process.exit();
});