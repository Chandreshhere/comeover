// Razorpay Checkout for business (Venue / Club) plans — NOT for consumer
// digital features (those go through store billing) and never a wallet.
// The backend creates the order and is the source of truth via the signed
// Razorpay webhook; the client result only drives UI.
import RazorpayCheckout from 'react-native-razorpay';
import { business } from '@/api/endpoints';
import { colors } from '@/theme/tokens';

// planId: 'venue_monthly' | 'club_monthly' …; venueId from onboarding.
export async function payForBusinessPlan({ planId, venueId, contact, email, name }) {
  const order = await business.createPaymentOrder({ planId, venueId });
  // order: { keyId, orderId, amount, currency, description }
  try {
    const result = await RazorpayCheckout.open({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency || 'INR',
      name: 'Come Over',
      description: order.description || 'Venue plan',
      prefill: { contact, email, name },
      theme: { color: colors.ink },
    });
    return { status: 'submitted', paymentId: result.razorpay_payment_id, orderId: result.razorpay_order_id };
  } catch (e) {
    // code 0 = cancelled by user (per SDK), 2 = network
    if (e?.code === 0 || e?.code === '0') return { status: 'cancelled' };
    return { status: 'failed', error: e?.description || e?.message || 'Payment failed' };
  }
}
