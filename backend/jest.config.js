module.exports = {
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  coveragePathIgnorePatterns: ['/node_modules/'],
  reporters: [
    'default',
    [
      'jest-html-reporters',
      {
        publicPath: '../test-report-backend',
        filename: 'index.html',
        pageTitle: 'Backend Test Report',
        expand: true,
        openReport: false,
        inlineSource: true,
      },
    ],
  ],
};
