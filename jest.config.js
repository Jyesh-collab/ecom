module.exports = {
  testEnvironment: 'jsdom',            // for React tests
  setupFiles: ['<rootDir>/jest.setup.js'],
  setupFilesAfterEnv: ['@testing-library/jest-dom/extend-expect'],
  moduleNameMapper: {
    '\\.(css|less|png|jpg|svg)$': 'identity-obj-proxy'
  },
  transform: {
    '^.+\\.(js|jsx)$': 'babel-jest'
  },
  transformIgnorePatterns: [
    '/node_modules/(?!@mui|react-material-ui-carousel)/'
  ],
  testPathIgnorePatterns: ['/node_modules/', '/build/'],
  reporters: [
    'default',
    [
      'jest-html-reporters',
      {
        publicPath: './test-report-frontend',
        filename: 'index.html',
        pageTitle: 'Frontend Test Report',
        expand: true,
        openReport: false,
        inlineSource: true,
      },
    ],
  ],
};
