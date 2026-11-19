// The confirmation repeats nothing the visitor typed: anyone can enter any address in the form,
// so it must be useless as a carrier for someone else's text.
const de = {
  notification: {
    from: '{name} Website',
    title: 'Neue Anfrage über die Website.',
    reply: 'Antworten',
    replyHint: 'Antworten geht direkt an die anfragende Person.',
  },
  confirmation: {
    subject: 'Ihre Anfrage an {name}',
    title: 'Danke für Ihre Nachricht.',
    body: [
      'Ihre Anfrage ist bei uns angekommen. Wir melden uns in der Regel innerhalb eines Werktags bei Ihnen.',
      'Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.',
      'Ihr {name}-Team',
    ],
  },
};

const en: typeof de = {
  notification: {
    from: '{name} website',
    title: 'New enquiry through the website.',
    reply: 'Reply',
    replyHint: 'Replying goes straight to the person who asked.',
  },
  confirmation: {
    subject: 'Your enquiry to {name}',
    title: 'Thank you for your message.',
    body: [
      'Your enquiry has reached us. We usually reply within one working day.',
      'If you did not send this enquiry, you can ignore this email.',
      'The {name} team',
    ],
  },
};

export default { de, en };
