window.onboardingPrefs = {
    hasSeenTutorial: () => localStorage.getItem('onboarding-tutorial-seen') === '1',
    markTutorialSeen: () => localStorage.setItem('onboarding-tutorial-seen', '1'),
    clearTutorialSeen: () => localStorage.removeItem('onboarding-tutorial-seen')
};
