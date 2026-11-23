// Learn more https://docs.expo.dev/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const clientRoot = path.resolve(projectRoot, '../client');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

// Let Metro see the repo's TypeScript client (../client/src), which lives
// outside the app folder.
config.watchFolders = [...(config.watchFolders ?? []), clientRoot];

// client/ has no node_modules of its own here; resolve its imports
// (@solana/web3.js) from the app so there is exactly one web3.js copy.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const fromClient = context.originModulePath.startsWith(clientRoot + path.sep);
  const isPackage = !moduleName.startsWith('.') && !path.isAbsolute(moduleName);
  const ctx =
    fromClient && isPackage
      ? { ...context, originModulePath: path.join(projectRoot, 'package.json') }
      : context;
  return defaultResolveRequest
    ? defaultResolveRequest(ctx, moduleName, platform)
    : context.resolveRequest(ctx, moduleName, platform);
};

module.exports = config;
