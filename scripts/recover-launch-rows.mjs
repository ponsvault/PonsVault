import { createPublicClient, http, parseAbiItem } from 'viem';

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const FACTORY = '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB';
const START = 8991118n;

const LOCKER_ABI = [
  {
    type: 'function',
    name: 'feeRedirects',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'address' }],
  },
];

const TOKEN_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'logo', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'description', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'deployer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
];

const FACTORY_ABI = [
  {
    type: 'function',
    name: 'getLaunchedToken',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { type: 'address', name: 'token' },
          { type: 'address', name: 'deployer' },
          { type: 'address', name: 'pairedToken' },
          { type: 'address', name: 'positionManager' },
          { type: 'uint256', name: 'positionId' },
          { type: 'uint256', name: 'dexId' },
          { type: 'uint256', name: 'launchConfigId' },
          { type: 'uint256', name: 'restrictionsEndBlock' },
          { type: 'uint256', name: 'supply' },
          { type: 'bool', name: 'isToken0' },
          { type: 'uint24', name: 'poolFee' },
          { type: 'bool', name: 'exists' },
          { type: 'uint256', name: 'initialBuyAmount' },
        ],
      },
    ],
  },
];

const LAUNCHED = parseAbiItem(
  'event TokenLaunched(address indexed token, address indexed deployer, address pairedToken, uint256 initialBuyAmount)',
);

const client = createPublicClient({ transport: http(RPC) });

const tokens = [
  '0x71c10c85fb19748ed526b01212e4f3d6d0dff997',
  '0xc79234a9918b15605a456c71d433879600420450',
];

async function recover(token) {
  const address = token.toLowerCase();
  const [name, symbol, logo, description, deployerOnToken, launched, block] = await Promise.all([
    client.readContract({ address, abi: TOKEN_ABI, functionName: 'name' }),
    client.readContract({ address, abi: TOKEN_ABI, functionName: 'symbol' }),
    client.readContract({ address, abi: TOKEN_ABI, functionName: 'logo' }),
    client.readContract({ address, abi: TOKEN_ABI, functionName: 'description' }),
    client.readContract({ address, abi: TOKEN_ABI, functionName: 'deployer' }),
    client.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: 'getLaunchedToken', args: [address] }),
    client.getBlock({ blockTag: 'latest' }),
  ]);

  let launchTx = null;
  let launchBlock = null;
  for (const eventName of [
    parseAbiItem('event TokenLaunched(address indexed token, address indexed deployer, address pairedToken, uint256 initialBuyAmount)'),
    parseAbiItem('event Launched(address indexed token, address indexed deployer, address pairedToken, uint256 initialBuyAmount)'),
  ]) {
    try {
      const logs = await client.getLogs({
        address: FACTORY,
        event: eventName,
        args: { token: address },
        fromBlock: START,
        toBlock: block.number,
      });
      if (logs[0]) {
        launchTx = logs[0].transactionHash;
        launchBlock = logs[0].blockNumber;
        break;
      }
    } catch {
      // try next signature
    }
  }

  const locker = '0x736D76699C26D0d966744cAe304C000d471f7F35';
  const redirect = await client.readContract({
    address: locker,
    abi: LOCKER_ABI,
    functionName: 'feeRedirects',
    args: [address],
  }).catch(() => null);

  const deployer = (launched?.deployer ?? deployerOnToken).toLowerCase();
  const zero = '0x0000000000000000000000000000000000000000';
  const feeWallet = (redirect && redirect.toLowerCase() !== zero ? redirect : deployer).toLowerCase();

  return {
    token: address,
    name,
    symbol,
    description: description || '',
    logo: logo || '',
    deployer,
    fee_wallet: feeWallet,
    transaction_hash: launchTx,
    launched_at: launchBlock ? new Date(Number(await client.getBlock({ blockNumber: launchBlock }).then((b) => b.timestamp)) * 1000).toISOString() : new Date().toISOString(),
  };
}

for (const token of tokens) {
  console.log(JSON.stringify(await recover(token), null, 2));
}
