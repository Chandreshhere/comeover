// Thin in-memory cache for the business hub (not persisted, no demo data).
// The API is the source of truth; this only shares the owner's venue between
// screens in a session and remembers that a plan payment was just submitted
// while the Razorpay webhook activates it server-side.
import { create } from 'zustand';

export const useBusinessStore = create((set) => ({
  myVenue: null,
  paymentSubmittedAt: null, // set after Razorpay checkout returns; cleared once the API shows the plan active
  setMyVenue: (myVenue) => set({ myVenue }),
  markPaymentSubmitted: () => set({ paymentSubmittedAt: new Date().toISOString() }),
  clearPayment: () => set({ paymentSubmittedAt: null }),
}));

export default useBusinessStore;
