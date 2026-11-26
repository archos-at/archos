export const onboarding = {
  validation: {
    nameRequired: 'Organization name is required.',
    nameTooLong: 'Organization name must be at most 100 characters.',
    homeCountryRequired: 'Choose the country your office is in.',
  },
  inviteOnly: {
    eyebrow: 'Invitation required',
    title: 'This platform is invite-only',
    description:
      'New organizations are created by the platform team. Ask your organization’s admin for an invitation — once invited, you’ll land directly in their workspace.',
    wrongAccount:
      'Signed in with the wrong account? Sign out and sign in with the one that received the invitation.',
  },
  account: {
    signedInAs: 'Signed in as {email}',
    signedIn: 'You are signed in.',
  },
  errors: {
    createFailed: 'Failed to create organization.',
    selfServeDisabled: 'Creating new organizations is disabled on this platform. Ask your administrator for an invitation.',
    generic: 'Something went wrong.',
    title: 'Organization setup failed',
  },
  form: {
    eyebrow: 'New organization',
    title: 'Name your organization',
    description:
      'Your organization is the private space for your office’s building projects, documents and colleagues. You’ll be its admin.',
    nameLabel: 'Organization name',
    namePlaceholder: 'Musterarchitektur ZT GmbH',
    nameHint: 'Usually your office or practice name.',
    homeCountryLabel: 'Country of your office',
    homeCountryPlaceholder: 'Choose a country',
    homeCountryHint: 'Where your office is seated. It does not decide which building law applies to a project: the site does.',
    homeCountries: {
      AT: 'Austria',
      DE: 'Germany',
      CH: 'Switzerland',
      LI: 'Liechtenstein',
    },
    submit: 'Create organization',
    invitedHint:
      'Expecting to join an existing organization? Ask its admin for an invitation instead — invited members skip this step.',
  },
  next: {
    heading: 'What happens next',
    private: 'Documents, chats and research stay inside your organization.',
    admin: 'As admin, you invite colleagues and decide what they can do.',
    tour: 'A one-minute tour shows you around.',
  },
  success: {
    title: 'Organization created',
    description: '{name} is ready, and you’re its admin.',
    redirecting: 'Opening your workspace…',
  },
  tour: {
    progress: '{current} of {total}',
    next: 'Next',
    back: 'Back',
    done: 'Get started',
    close: 'Close tour',
    stops: {
      welcome: {
        title: 'Welcome to {productName}',
        body: 'Your organization is ready. Here is a quick look at where things live.',
      },
      welcomeJoined: {
        title: 'Welcome to {productName}',
        body: 'This is where your office works on its projects, with {productName} as a colleague. Here is a quick look at where things live.',
      },
      sides: {
        title: 'Personal or project',
        body: 'One switch, two sides. Personal: your own chats and “Meine Ablage”, for you alone. Project: everything about one building, with everyone working on it.',
      },
      menuPhone: {
        title: 'Everything in the menu',
        body: 'The menu at the top left opens everything: personal or project, your projects, the files, the office library, the inbox and your account.',
      },
      projects: {
        title: 'Your projects',
        body: 'Click {productName} to open the project overview. Start a project there: one building with its files, its people and its chats.',
      },
      projectsJoined: {
        title: 'Your projects',
        body: 'Click {productName} to open the project overview. Projects appear there as colleagues add you; you can start your own there too.',
      },
      menuPhoneShelfless: {
        title: 'Everything in the menu',
        body: 'The menu at the top left opens everything: personal or project, your projects, the files, the inbox and your account.',
      },
      officeShelf: {
        title: 'Office library',
        body: 'Your office’s shared documents: standard details, specifications, templates. File something here once and every project draws on it.',
      },
      inbox: {
        title: 'Inbox',
        body: 'Mentions, requests and updates from your colleagues arrive here.',
      },
      search: {
        title: 'Search',
        body: 'The magnifier finds any file, chat and project in the office.',
        palette: 'Search',
        cheatsheet: 'All shortcuts',
      },
      account: {
        title: 'Your account and office',
        body: 'Profile, theme, language and this tour. Invite colleagues under Organization; if you belong to several offices, switch here.',
      },
      accountMember: {
        title: 'Your account',
        body: 'Profile, theme, language and this tour. If you belong to several offices, switch here. Members and roles are managed by your admins.',
      },
      projectWelcome: {
        title: 'Your project is set up',
        body: '{productName} now knows the basics of this building. Here is where the work happens.',
      },
      projectWelcomeJoined: {
        title: 'Inside a project',
        body: 'Every building gets a space like this one. Here is where the work happens.',
      },
      projectChat: {
        title: 'Work with {productName}',
        body: 'Ask {productName} about this building, or hand it a task. Your earlier chats are below, under “Recent chats”.',
      },
      projectChatPhone: {
        title: 'Work with {productName}',
        body: 'Ask {productName} about this building, or hand it a task. Your chats are in the menu at the top left.',
      },
      projectFiles: {
        title: 'Documents',
        body: 'Drawings, reports and correspondence for this building. Once a file has been read, {productName} quotes it, only inside this project.',
      },
      filesOrOfficeShelf: {
        title: 'Documents or Office library?',
        body: 'Ask who the document belongs to.',
        filesTerm: 'Documents: this building',
        filesDetail: 'Its drawings, reports, correspondence. Cited only in this project.',
        officeShelfTerm: 'Office library: the office',
        officeShelfDetail: 'Standard details, specifications, templates. Cited in every project.',
      },
      filesOrOfficeShelfPhone: {
        title: 'Documents or Office library?',
        body: 'Ask who the document belongs to. You find both in the menu at the top left.',
      },
      projectSources: {
        title: 'Every answer shows its sources',
        body: 'Each claim shows where it came from: building law, the project’s files or the Office library, and opens the passage. If {productName} has no source, it says so.',
      },
      projectSettings: {
        title: 'Switch projects, set this one up',
        body: 'The project name opens the list of your projects. The cog beside a project leads to its settings: invite the people involved, adjust the key facts.',
      },
      projectSettingsPhone: {
        title: 'People and key facts',
        body: 'Under “Project settings” in the menu you see where this project stands. Invite the people involved and adjust the key facts there.',
      },
    },
  },
}
