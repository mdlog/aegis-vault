AEGIS VAULT — DEMO VIDEO TELEPROMPTER SCRIPT

Target: 5 minutes 0 seconds to 5 minutes 30 seconds.
Speaking pace: 140 to 150 words per minute. Pause one beat between paragraphs.
Anything inside square brackets is a stage cue — do not read it aloud.


================================================================
[0:00] HOOK
================================================================

Most AI trading bots ask you to trust the operator with your funds.

Aegis Vault doesn't.

The operator runs an AI, signs a trade intent, and submits it to your vault — but the vault is the one that decides whether to execute.

Today I'll walk through the full lifecycle on 0G Mainnet.

Registering as an operator.

Creating a depositor vault that binds to that operator's strategy.

And watching the on-chain policy approve one trade and reject another.

Everything you'll see is a real transaction.


================================================================
[0:25] FLOW 1 — CREATE OPERATOR
================================================================

I'm logging in as an operator first.

To register, I have to publish a strategy manifest — a JSON document declaring exactly what assets I'll trade, my position size cap, cooldown, and risk parameters.

The hash of that manifest gets committed on-chain.

[Fill the form.]

Notice the form auto-computes keccak256 of the manifest JSON.

That hash is what gets stored in OperatorRegistry.

If I publish one manifest and trade outside it later, the on-chain commitment is the evidence — AegisGovernor can slash my stake.

[Click Publish Manifest. MetaMask popup.]

MetaMask is asking me to sign the publishManifest call.

The transaction pays a few hundred thousand gas, and once it lands, my operator address is permanently bound to that hash.

[Tx confirms. Open the explorer.]

On-chain.

The manifest hash is now part of my operator profile.

[Back to the form. Step 2: bond stake.]

Now the stake.

The marketplace has five tiers — None, Bronze, Silver, Gold, Platinum.

The lowest tier the orchestrator will actually route trades to is Bronze, because our orchestrator runs in strict mode and refuses zero stake operators by design.

I'm bonding 500 USDC dot e.

That's denominated in the same asset depositors use — so there's no token price shell game.

It's real dollars at risk.

[Approve USDC.e, confirm bond.]

Stake bonded.

My operator card will show up in the marketplace in a few seconds — fresh, eligible, slashable.

[Navigate to /marketplace and find the new operator card.]


================================================================
[1:35] FLOW 2 — CREATE VAULT
================================================================

Now I switch hats.

I'm a depositor.

I want an AI vault — but I want one whose strategy is committed before I deposit, not retro-rationalized after.

[Navigate to /create. Step 1: pick operator.]

I'm picking the operator I just registered.

See that hash next to their name?

That's the accepted manifest hash my vault will commit to.

From the moment I deploy, this operator cannot silently switch strategies on me.

Every intent they submit must match this hash, or executeIntent reverts.

[Step 2: deposit 200 USDC.e. Step 3: Policy.]

This is the part depositors should care about most.

The operator can suggest default policy values — that's the gold suggested badge.

But I decide the final values.

Max position 50 percent.

Minimum AI confidence 60 percent.

Max slippage 1 percent.

Asset whitelist: stablecoin, wrapped ETH, wrapped 0G — nothing else.

Once this vault is deployed, these values are part of policy in storage.

Any trade intent that fails any one of them — executeIntent reverts.

There is no admin key that overrides this.

No Aegis team key.

Just the contract.

[Step 4: toggle sealed mode ON.]

Sealed mode on.

This forces the operator into a two block commit reveal.

They call commitIntent at block N, and can only call executeIntent at block N plus one or later.

MEV searchers can't see the trade before it lands.

[Step 5: deploy. MetaMask popup.]

MetaMask is showing the factory call.

This is V4 — AegisVaultFactoryV4.

It deploys a minimal proxy clone, about four hundred thousand gas, and writes the operator's manifest hash into the new vault's storage as accepted manifest hash.

Immutable from this block forward.

[Tx confirms. Open the vault detail page.]

There it is.

My vault, my policy, bound to that specific operator manifest.

The marketplace has gained one vault and one depositor.


================================================================
[2:55] FLOW 3 — LIVE EXECUTION
================================================================

[Cut to orchestrator terminal.]

The orchestrator polls every vault on a schedule.

It runs inference on 0G Compute, using the model bound by the policy's attested signer, and produces a signed intent.

Watch what happens when it sees a vault eligible for a trade.

[Wait for next decision cycle.]

Cycle fires.

AI returns buy W 0 G with 72 percent confidence — above my 60 percent threshold.

Attestation hash computed.

Orchestrator commits at block N — that's the first transaction.

One block later, it reveals — that's the second transaction.

[Open the executeIntent tx on chainscan.]

Here's the executed trade on the explorer.

Look inside the calldata.

Attestation report hash is a bytes 32 field of the EIP 712 typehash.

The vault ec-recovered the signature, the signer matched the policy's attested signer, the manifest hash matched the operator's commitment — every gate cleared.

Swap atomic.

Position open.


================================================================
[3:45] FLOW 4 — POLICY REVERT
================================================================

[Back to Actions tab on the vault page.]

Most cycles don't trade.

Most cycles look like this.

[Highlight a vetoed row.]

AI confidence came in at 42 percent.

My policy threshold is 60 percent.

The decision engine never even tried to submit the intent — the gate failed off chain.

Cheaper for everyone.

Same outcome.

And even if the orchestrator had submitted it, the on chain confidence check in ExecLib would have reverted.

Belt and suspenders.


================================================================
[4:15] FLOW 5 — REPUTATION AND GOVERNANCE
================================================================

[Navigate to the operator profile.]

Operator profile.

Total executions.

Cumulative profit and loss.

User ratings.

All append only, all in OperatorReputation.

An operator can't spin up a new identity to escape a bad track record.

Reputation is welded to the operator address, which is welded to the staked USDC dot e.

[Pan to /governance.]

Admin and arbitrator on every marketplace contract — Registry, Staking, Reputation, Insurance — point at this multisig.

Slash, treasury spend, operator delisting — all require multisig approval.

No single key has unilateral power.

Governance commitment readable on chain — not promised in docs.


================================================================
[4:45] CLOSE
================================================================

What you just watched is the full lifecycle on V4 mainnet.

Operator registers with a slashable strategy hash.

Depositor creates a vault whose policy is committed before the first deposit.

AI proposes.

Vault decides.

MEV doesn't get a look in.

Aegis Vault.

Live at aegis vaults dot xyz.

V4 factory on 0G at zero x nine e three six — ending in two A five F.

Source at github dot com slash mdlog.

Every AI output is bound to its execution.

Every operator commits a slashable strategy hash.

Every chain runs the same bytecode.

Thanks for watching.


================================================================
END
================================================================


READING NOTES (do not read these aloud)

— Hard numbers like "72 percent" and "60 percent" — slow down a quarter beat before each one.
— Acronyms on first use: "EIP 712 — the Ethereum typed data standard." After that, use freely.
— Function names ("publishManifest", "executeIntent", "commitIntent", "executeIntent") — say them as one word, no spelling out.
— Addresses: read only the short prefix and tail. "Zero x nine e three six … ending in two A five F." The full address is on screen.
— "USDC.e" — say "USDC dot e", not "USDC e".
— "ec-recover" — say "ee-see-recover" or simply "the contract recovered the signature." Whichever feels natural.
— "0G" — say "zero G".
— "W0G" — say "wrapped zero G" the first time, "W zero G" thereafter.
— Pause one full beat between numbered policy values (50 percent … 60 percent … 1 percent …).
— Pause two beats before each block-quote-style sentence in the CLOSE section ("AI proposes." … "Vault decides." …).
