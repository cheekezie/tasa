/**
 * What a seller agrees to before selling tickets. `version` must match the API's
 * SELLER_TERMS_VERSION: change both together, and sellers accept again before their next event.
 * English only on purpose: this is the binding text.
 */
export const SELLER_TERMS = {
  version: '2026-11-01',
  sections: [
    {
      title: 'Your events',
      body: 'You are the organiser of every event you create on Tasa, and you are responsible for running it as described: the date, venue, what each ticket covers and anything else you tell buyers. Tasa sells tickets on your behalf and is not the organiser.',
    },
    {
      title: 'Who you are',
      body: 'You need a verified BVN or NIN on file to sell. Buyers see your organisation name and logo, not your personal name, so they must belong to you and must not copy another business or person.',
    },
    {
      title: 'Fees',
      body: 'Tasa takes a selling fee from every ticket sold, and buyers pay a service charge on top of the ticket price. The current fees are shown before you publish and while you set prices. They can change, but a change never applies to tickets already sold.',
    },
    {
      title: 'Refunds',
      body: 'You choose whether buyers can cancel, and for how many days, when you create an event. That choice cannot be changed later. Buyers who cancel inside the window are refunded automatically without your approval, and Tasa keeps the service charge.',
    },
    {
      title: 'Your money',
      body: 'Sales go to your ticket wallet. Money from tickets that can still be refunded stays on hold until the refund window closes; the rest can be withdrawn to your Tasa wallet at any time. Your bank account is checked with your bank, and its name must match your verified identity.',
    },
    {
      title: 'No cancelling',
      body: 'A published event cannot be cancelled or edited. You can stop sales or change how many tickets are on sale at any time. If an event does not happen, you must refund buyers yourself and tell them through the contacts you gave.',
    },
    {
      title: 'At the door',
      body: 'Each ticket has a QR code that works once. Only you and the door staff you add can scan tickets for your event.',
    },
    {
      title: 'What you cannot sell',
      body: 'No events that are illegal, misleading, or that you are not allowed to run. Tasa may pause sales on any event that breaks these terms or gets serious complaints, and may hold your money while we look into it.',
    },
    {
      title: 'Ratings',
      body: 'People whose tickets were scanned can rate your event. Your number of events and your average rating are shown to buyers.',
    },
  ],
};
