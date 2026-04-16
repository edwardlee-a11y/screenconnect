import { ethers, network, run } from 'hardhat';

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;

  console.log('\n═══════════════════════════════════════════');
  console.log(' SpinAndWin Deployment');
  console.log('═══════════════════════════════════════════');
  console.log(` Network  : ${networkName}`);
  console.log(` Deployer : ${deployer.address}`);

  const balance = await deployer.provider.getBalance(deployer.address);
  console.log(` Balance  : ${ethers.formatEther(balance)} MATIC`);

  if (balance === 0n) {
    throw new Error('Deployer wallet has no MATIC. Fund it before deploying.');
  }

  // ── Deploy ──────────────────────────────────────────────────────────────────
  console.log('\n[1/4] Deploying SpinAndWin...');
  const SpinAndWin = await ethers.getContractFactory('SpinAndWin');
  const contract   = await SpinAndWin.deploy();
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  console.log(`      ✓ Deployed at: ${contractAddress}`);

  // ── Fund prize pool ─────────────────────────────────────────────────────────
  const initialFundMatic = networkName === 'polygon' ? '1.0' : '0.1';
  const fundAmount = ethers.parseEther(initialFundMatic);

  if (balance > fundAmount) {
    console.log(`\n[2/4] Funding prize pool with ${initialFundMatic} MATIC...`);
    const fundTx = await deployer.sendTransaction({
      to: contractAddress,
      value: fundAmount,
    });
    await fundTx.wait(1);
    console.log(`      ✓ Prize pool funded. Tx: ${fundTx.hash}`);
  } else {
    console.log('\n[2/4] Skipping prize pool fund — insufficient balance.');
  }

  // ── Verify prize pool ───────────────────────────────────────────────────────
  console.log('\n[3/4] Verifying contract state...');
  const prizePool = await contract.prizePool();
  const owner     = await contract.owner();
  console.log(`      Prize pool : ${ethers.formatEther(prizePool)} MATIC`);
  console.log(`      Owner      : ${owner}`);

  // ── Verify on Polygonscan ───────────────────────────────────────────────────
  if (process.env.POLYGONSCAN_API_KEY) {
    console.log('\n[4/4] Verifying on Polygonscan (waiting 15s for indexing)...');
    await new Promise(r => setTimeout(r, 15000));
    try {
      await run('verify:verify', {
        address: contractAddress,
        constructorArguments: [],
      });
      console.log('      ✓ Verified on Polygonscan');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Already Verified')) {
        console.log('      ✓ Already verified');
      } else {
        console.warn('      ⚠ Verification failed (manual verify later):', msg);
      }
    }
  } else {
    console.log('\n[4/4] Skipping Polygonscan verification (no API key set).');
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  const explorerBase = networkName === 'polygon'
    ? 'https://polygonscan.com'
    : 'https://amoy.polygonscan.com';

  console.log('\n═══════════════════════════════════════════');
  console.log(' DEPLOYMENT COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log(` Contract : ${contractAddress}`);
  console.log(` Explorer : ${explorerBase}/address/${contractAddress}`);
  console.log('\n ⚠  Add this to your backend .env:');
  console.log(`    POLYGON_CONTRACT_ADDRESS=${contractAddress}`);
  console.log('═══════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
