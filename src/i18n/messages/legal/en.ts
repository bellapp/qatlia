import type { LegalCatalog } from './fr';

export const legalEn: LegalCatalog = {
  updated: 'Last updated: {date}',
  backHome: 'Back to home',
  otherDocs: 'Legal documents',
  contactLine: 'Questions about these documents? Email us at {email} or message us on WhatsApp at {whatsapp}.',
  checkoutNotice: 'By paying you accept our terms:',
  nav: {
    terms: 'Terms of Service',
    privacy: 'Privacy',
    refund: 'Refunds',
  },
  terms: {
    title: 'Terms of Service and Sale',
    summary: 'The rules for using QatliA and the conditions for buying credits.',
    sections: {
      s1: {
        title: 'Who we are',
        body:
          'QatliA is an online service, available at qatlia.ma, that helps woodworkers prepare their cutting plans. It is operated by an individual based in Morocco.\n\n' +
          'To reach us: {email} or WhatsApp at {whatsapp}.\n\n' +
          'By creating an account or buying credits, you accept these terms. If you do not accept them, do not use the service.',
      },
      s2: {
        title: 'The service',
        body:
          'With QatliA you can:\n' +
          '- photograph a cut list and extract its pieces with artificial intelligence;\n' +
          '- compute an optimized cutting plan for your panels;\n' +
          '- export the plan (PDF, DXF, image) and prepare a quote for your customer.\n\n' +
          'The service evolves regularly: a feature may be added, changed or withdrawn.',
      },
      s3: {
        title: 'Your account',
        body:
          'You create an account with an email address and a password, or with your Google account. The information you provide must be accurate.\n\n' +
          'You are responsible for keeping your password confidential and for what is done from your account. Tell us straight away if you think someone else has used it.',
      },
      s4: {
        title: 'Credits',
        body:
          'Some actions use credits:\n' +
          '- a successful photo analysis: {visionCost} credits;\n' +
          '- an optimization run: {optimizeCost} credit;\n' +
          '- exports and quotes are free.\n\n' +
          'Every new account receives {freeCredits} free credits. A failed analysis is not charged.\n\n' +
          'Credits stay on your balance for as long as your account is open. They have no cash value: they cannot be exchanged for money (except for a refund under our refund policy) or transferred to another account.',
      },
      s5: {
        title: 'Prices and payment',
        body:
          'Pack prices are shown on the Credits page before any payment.\n\n' +
          'Card payments are processed by Creem, our authorized reseller (Merchant of Record). Creem is the seller of the transaction, collects any applicable taxes, appears on your bank statement and sends you the receipt. Its own terms apply to the payment. Card prices are in US dollars (USD).\n\n' +
          'Manual payments in dirhams (agency, money transfer, bank transfer): you receive an order number, and the credits are added once your payment has been checked.\n\n' +
          'We never see or store your card details.',
      },
      s6: {
        title: 'Atelier Max subscription',
        body:
          'The Atelier Max pack is a monthly subscription: it renews and is billed automatically every month, and its credits are added to your balance at each renewal.\n\n' +
          'You can cancel at any time, from the management link sent by email with your Creem receipt or by writing to us. Cancelling stops the following renewals; credits already received stay usable.',
      },
      s7: {
        title: 'Refunds',
        body:
          'Purchased credits you have not used can be refunded for {days} days after the payment, under the conditions of our refund policy.',
      },
      s8: {
        title: 'Your content',
        body:
          'Your projects, photos and quotes belong to you. You only authorize us to process them in order to provide the service.\n\n' +
          'If you enter your own customers’ details (in a quote, for example), you must be entitled to do so, and you remain responsible to them for that data.',
      },
      s9: {
        title: 'Check before you cut',
        body:
          'An AI reading of a photo can contain mistakes (a misread figure, a missed piece), and a cutting plan depends on the dimensions you enter. Always review the piece list and the plan before cutting a panel.\n\n' +
          'QatliA is provided as is. We cannot be held liable for lost material or a wrong cut that results from a plan that was not checked. In any case, our liability is limited to the amount you paid us over the last twelve months.\n\n' +
          'We do what is needed to keep the service available, but cannot guarantee uninterrupted or error-free operation.',
      },
      s10: {
        title: 'Prohibited use',
        body:
          'You must not:\n' +
          '- bypass the credit count or the limits of the service;\n' +
          '- scrape data at scale, disrupt the service or try to access an account that is not yours;\n' +
          '- use the service for any illegal activity.\n\n' +
          'If you do, we may suspend or close the account concerned.',
      },
      s11: {
        title: 'Closing your account',
        body:
          'You can ask us to close your account at any time by writing to us. Any remaining credits are then lost, unless they are still refundable under our refund policy.',
      },
      s12: {
        title: 'Changes',
        body:
          'We may change these terms. The update date is shown at the top of the page; for a significant change, we let you know in the app or by email. Continuing to use QatliA after the change means you accept it.',
      },
      s13: {
        title: 'Governing law and disputes',
        body:
          'These terms are governed by Moroccan law. If you disagree with us, write to us first: we always look for an amicable solution. Failing that, the dispute will go before the competent Moroccan courts, without prejudice to the rights the law of your country of residence gives you as a consumer.',
      },
    },
  },
  privacy: {
    title: 'Privacy Policy',
    summary: 'What data QatliA collects, why, who it is shared with and how to exercise your rights.',
    sections: {
      s1: {
        title: 'Data controller',
        body:
          'QatliA processes the data described here. For any question or request: {email} or WhatsApp at {whatsapp}.\n\n' +
          'We apply Moroccan law no. 09-08 on the protection of personal data and, for users in the European Union, the principles of the GDPR.',
      },
      s2: {
        title: 'The data we collect',
        body:
          '- Account: email address, the name provided by Google if you sign in with it, your chosen language. Your password is handled by our authentication provider and is never stored in plain text.\n' +
          '- Projects: the pieces, dimensions, materials, settings and cutting plans you save.\n' +
          '- Quotes: your company’s details and your customer’s details that you enter in a quote saved on a project.\n' +
          '- Photos of cut lists: sent for analysis when you submit them. QatliA does not store them.\n' +
          '- Credits and payments: balance, credit history, manual orders (number, pack, payment method, status). For a card payment, Creem confirms the transaction to us; your card details stay with Creem.\n' +
          '- Support: the messages you send us by email or WhatsApp.\n' +
          '- Technical data: connection logs (IP address, browser) kept by our providers for security.',
      },
      s3: {
        title: 'Why we use it',
        body:
          '- To provide the service: account, analyses, plans, exports (performance of the contract).\n' +
          '- To process payments and keep our accounts (legal obligation).\n' +
          '- To protect the service against fraud and abuse (legitimate interest).\n' +
          '- To answer your support requests.\n\n' +
          'We do not sell your data, we show no advertising and we do not use your projects to train an AI model.',
      },
      s4: {
        title: 'Our providers',
        body:
          'We use providers that process data on our behalf, only to run the service:\n' +
          '- Supabase: database and authentication;\n' +
          '- our web host: serving the site and running the application;\n' +
          '- OpenRouter, which passes your photos to the AI model that reads them (currently Google Gemini);\n' +
          '- Google: signing in with a Google account, if you choose it;\n' +
          '- Creem: card payments, as authorized reseller;\n' +
          '- WhatsApp and our email service: conversations with support.\n\n' +
          'These providers are located outside Morocco (European Union, United States), so your data is transferred there, under the contractual safeguards they offer.',
      },
      s5: {
        title: 'Cookies and local storage',
        body:
          'QatliA only uses the cookies and local storage it needs to work:\n' +
          '- session cookies, to keep you signed in;\n' +
          '- your language, theme and display unit;\n' +
          '- your company details for quotes, kept in your browser only.\n\n' +
          'No advertising or audience-measurement cookies. The Creem payment page uses its own cookies.',
      },
      s6: {
        title: 'How long we keep it',
        body:
          '- Account, projects and quotes: while your account is open, then deleted within 30 days of its closure.\n' +
          '- Photos: not kept by QatliA after the analysis.\n' +
          '- Payments and credit history: for the period required by accounting and tax obligations.\n' +
          '- Support messages: for as long as it takes to handle your request and its follow-up.',
      },
      s7: {
        title: 'Security',
        body:
          'Connections are encrypted (HTTPS). Each account can only access its own data, and sensitive operations (credits, payments) are performed by our servers only. No system is infallible: tell us if you notice a problem.',
      },
      s8: {
        title: 'Your rights',
        body:
          'You can ask to access your data, correct it, delete it, object to a processing or receive a copy of your projects. Your account is deleted on simple request to {email} or on WhatsApp. We answer within 30 days.\n\n' +
          'If you believe your rights are not respected, you can contact the CNDP (Morocco’s data protection authority, cndp.ma) or the data protection authority of your country.',
      },
      s9: {
        title: 'Who the service is for',
        body:
          'QatliA is meant for professionals and adults. It is not intended for anyone under 18.',
      },
      s10: {
        title: 'Changes',
        body:
          'We will update this policy if our practices or providers change. The update date is shown at the top of the page.',
      },
    },
  },
  refund: {
    title: 'Refund Policy',
    summary: 'When and how unused credits are refunded.',
    sections: {
      s1: {
        title: 'The principle',
        body:
          'You have {days} days after a payment to ask for a refund of the purchased credits you have not used yet.\n\n' +
          'The refund is proportional to the unused credits: price paid × unused pack credits ÷ pack credits. If you have used none of the pack’s credits, you are refunded in full.',
      },
      s2: {
        title: 'How used credits are counted',
        body:
          'Credits are used in the order you received them: first the {freeCredits} free sign-up credits, then each purchase, oldest first.\n\n' +
          'Refunded credits are removed from your balance.',
      },
      s3: {
        title: 'What is not refundable',
        body:
          '- credits already used;\n' +
          '- the free sign-up credits;\n' +
          '- a request made more than {days} days after the payment;\n' +
          '- credits obtained through fraud or in breach of our terms of service.',
      },
      s4: {
        title: 'Atelier Max subscription',
        body:
          'You can cancel the subscription at any time: cancelling stops the following renewals.\n\n' +
          'The last billed month is refundable under the same rule: within {days} days of that charge, in proportion to that month’s unused credits. Earlier months are not refundable.',
      },
      s5: {
        title: 'A credit charged by mistake',
        body:
          'If a credit was charged wrongly (an outage, a double charge), write to us: we give it back, however much time has passed.',
      },
      s6: {
        title: 'Making a request',
        body:
          'Write to us at {email} or on WhatsApp at {whatsapp}, with your account’s email address and the Creem receipt or your order number (QIA-…).\n\n' +
          'We answer within 3 business days. Once the request is accepted:\n' +
          '- card payment: Creem issues the refund to the card you used; how long it takes to show on your account depends on your bank;\n' +
          '- manual payment in dirhams: we refund by bank transfer or through the same method you paid with, within 14 days.\n\n' +
          'Before opening a dispute with your bank, contact us: it is almost always faster.',
      },
    },
  },
};
