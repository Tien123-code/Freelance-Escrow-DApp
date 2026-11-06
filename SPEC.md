\# TASK SPECIFICATION: Decentralized Freelance Escrow DApp

\## 1. Project Overview

Build a complete, lightweight, decentralized Freelance Escrow web application (DApp) for an introductory blockchain university project.

The system eliminates trust issues between clients and freelancers by locking payment in an EVM Smart Contract upon job creation, releasing funds upon client verification (or automatic timeout), and supporting dispute resolution via an arbiter.

\## 2. Technical Stack & Architectural Constraints

\- \*\*Smart Contract Language:\*\* Solidity \`^0.8.20\`.

\- \*\*Target Network:\*\* EVM / Ethereum Sepolia Testnet.

\- \*\*Frontend Architecture:\*\* Pure Client-side (Vanilla HTML5 + Tailwind CSS via CDN + Ethers.js v5 or v6 CDN). NO centralized Node.js/Python backend, NO database (all state must reside on-chain).

\- \*\*Proof Storage:\*\* Off-chain GitHub commit URLs / Commit SHAs or IPFS hashes (Pinata).

\- \*\*Wallet Provider:\*\* Browser extension (MetaMask / EIP-1193 provider).

\## 3. Project Directory Structure

Scaffold and implement the project following this layout:

\`\`\`text

.

├── contracts/

│ └── FreelanceEscrow.sol # The complete Solidity Smart Contract

├── frontend/

│ ├── index.html # Clean single-page application UI (Tailwind CSS)

│ ├── app.js # Web3 connection, contract interactions, event listeners

│ └── style.css # Minor custom styling if needed

├── README.md # Setup, deployment guide, and demo walkthrough

4\. Smart Contract Specifications (contracts/FreelanceEscrow.sol)

4.1 State Machine

Enum JobStatus:

Created: Job created and escrow funds deposited/locked.

Submitted: Freelancer delivered work (GitHub commit link or IPFS hash).

Completed: Client approved and funds released to freelancer.

Disputed: Either party initiated dispute; contract awaits Arbiter resolution.

Cancelled: Job timed out before submission; client refunded.

4.2 Data Models

struct Job:

uint256 id

address payable client

address payable freelancer

string title

uint256 amount (in wei)

string workHash (GitHub commit URL / hash or IPFS CID)

uint256 deadline (unix timestamp)

uint256 submittedAt (unix timestamp)

JobStatus status

address public arbiter (Contract deployer by default).

uint256 public constant REVIEW\_PERIOD = 3 days;

Mapping mapping(uint256 => Job) public jobs;

Counter uint256 public jobCounter;

4.3 Core Functions & Security Invariants

createJob(address payable \_freelancer, string calldata \_title, uint256 \_durationDays) external payable returns (uint256):

Validates: msg.value > 0, \_freelancer != address(0), \_freelancer != msg.sender, \_durationDays > 0.

Locks funds directly in contract balance.

submitWork(uint256 \_jobId, string calldata \_workHash) external:

Only freelancer can call.

Status must be Created.

Current time must be <= deadline.

Updates status to Submitted, sets submittedAt = block.timestamp.

approveAndPay(uint256 \_jobId) external:

Only client can call.

Status must be Submitted.

Adhere strictly to Checks-Effects-Interactions: update status to Completed before transferring amount via .call{value: ...}("").

claimTimeout(uint256 \_jobId) external:

Only freelancer can call.

Requires status Submitted and block.timestamp > submittedAt + REVIEW\_PERIOD.

Releases funds to freelancer.

cancelTimeout(uint256 \_jobId) external:

Only client can call.

Requires status Created and block.timestamp > deadline.

Refunds locked balance to client.

raiseDispute(uint256 \_jobId) external:

Accessible by either client or freelancer if job is Created or Submitted.

Changes status to Disputed.

resolveDispute(uint256 \_jobId, uint256 \_freelancerPercent) external:

Only callable by arbiter.

Status must be Disputed, \_freelancerPercent <= 100.

Splits and transfers funds proportionally.

5\. Frontend Requirements (frontend/index.html & app.js)

Wallet Connection & Context:

Detect MetaMask (window.ethereum).

"Connect Wallet" button showing truncated address (0x12...34) upon success.

Display and handle network switching (prompt if not on Sepolia).

Input field to configure deployed Contract Address with persistent local storage caching.

User Role Views / Panels:

Client Panel: Create new job (freelancer address, title, duration in days, ETH value with automatic conversion to wei).

Freelancer Panel: Submit work proof by entering Job ID and pasting GitHub Commit URL/Hash.

Inspection & Action Panel:

Query job details by ID (show status badges, client/freelancer addresses, deposit amount, submitted proof link, time remaining).

Contextual action buttons: "Approve & Pay" (for client), "Claim Payout" (if timeout reached), "Cancel & Refund" (if deadline passed), "Raise Dispute".

Status & Transaction Logs: Live toast notifications or a terminal-like log block showing pending transaction hashes, confirmations, and revert error messages.

6\. Execution Instructions for Claude / Codex

Write the clean, fully-commented contracts/FreelanceEscrow.sol.

Generate the responsive, production-ready frontend/index.html and modular frontend/app.js using modern async/await syntax and Ethers.js.

Include ABI definition inside frontend/app.js so it works out of the box once the user pastes their deployed contract address.

Output a clear README.md explaining:

How to compile & deploy using Remix IDE.

How to run the frontend locally (e.g., VS Code Live Server or python http server).

3-step test scenario (Client deposit -> Freelancer submit commit -> Client release funds).