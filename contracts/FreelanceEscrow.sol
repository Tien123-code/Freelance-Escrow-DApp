// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title FreelanceEscrow
/// @notice Holds each job's ETH until approval, timeout, cancellation or arbitration.
contract FreelanceEscrow {
    enum JobStatus { Created, Submitted, Completed, Disputed, Cancelled }

    struct Job {
        uint256 id;
        address payable client;
        address payable freelancer;
        string title;
        uint256 amount;
        string workHash;
        uint256 deadline;
        uint256 submittedAt;
        JobStatus status;
    }

    address public immutable arbiter;
    uint256 public constant REVIEW_PERIOD = 3 days;
    mapping(uint256 => Job) public jobs;
    uint256 public jobCounter;

    event JobCreated(uint256 indexed jobId, address indexed client, address indexed freelancer, uint256 amount, uint256 deadline);
    event WorkSubmitted(uint256 indexed jobId, string workHash, uint256 submittedAt);
    event JobCompleted(uint256 indexed jobId, uint256 freelancerAmount, uint256 clientAmount);
    event JobCancelled(uint256 indexed jobId);
    event DisputeRaised(uint256 indexed jobId, address indexed raisedBy);

    constructor() { arbiter = msg.sender; }

    modifier existingJob(uint256 jobId) {
        require(jobId > 0 && jobId <= jobCounter, "Job does not exist");
        _;
    }

    function createJob(address payable freelancer, string calldata title, uint256 durationDays)
        external payable returns (uint256)
    {
        require(msg.value > 0, "Deposit must be positive");
        require(freelancer != address(0) && freelancer != msg.sender, "Invalid freelancer");
        require(bytes(title).length > 0, "Title is required");
        require(durationDays > 0, "Duration must be positive");
        uint256 id = ++jobCounter;
        uint256 deadline = block.timestamp + durationDays * 1 days;
        jobs[id] = Job(id, payable(msg.sender), freelancer, title, msg.value, "", deadline, 0, JobStatus.Created);
        emit JobCreated(id, msg.sender, freelancer, msg.value, deadline);
        return id;
    }

    function submitWork(uint256 jobId, string calldata workHash) external existingJob(jobId) {
        Job storage job = jobs[jobId];
        require(msg.sender == job.freelancer, "Only freelancer");
        require(job.status == JobStatus.Created, "Job is not open");
        require(block.timestamp <= job.deadline, "Deadline passed");
        require(bytes(workHash).length > 0, "Proof is required");
        job.workHash = workHash;
        job.submittedAt = block.timestamp;
        job.status = JobStatus.Submitted;
        emit WorkSubmitted(jobId, workHash, block.timestamp);
    }

    function approveAndPay(uint256 jobId) external existingJob(jobId) {
        Job storage job = jobs[jobId];
        require(msg.sender == job.client, "Only client");
        require(job.status == JobStatus.Submitted, "Work not submitted");
        job.status = JobStatus.Completed;
        emit JobCompleted(jobId, job.amount, 0);
        _send(job.freelancer, job.amount);
    }

    function claimTimeout(uint256 jobId) external existingJob(jobId) {
        Job storage job = jobs[jobId];
        require(msg.sender == job.freelancer, "Only freelancer");
        require(job.status == JobStatus.Submitted, "Work not submitted");
        require(block.timestamp > job.submittedAt + REVIEW_PERIOD, "Review period not over");
        job.status = JobStatus.Completed;
        emit JobCompleted(jobId, job.amount, 0);
        _send(job.freelancer, job.amount);
    }

    function cancelTimeout(uint256 jobId) external existingJob(jobId) {
        Job storage job = jobs[jobId];
        require(msg.sender == job.client, "Only client");
        require(job.status == JobStatus.Created, "Job is not open");
        require(block.timestamp > job.deadline, "Deadline not passed");
        job.status = JobStatus.Cancelled;
        emit JobCancelled(jobId);
        _send(job.client, job.amount);
    }

    function raiseDispute(uint256 jobId) external existingJob(jobId) {
        Job storage job = jobs[jobId];
        require(msg.sender == job.client || msg.sender == job.freelancer, "Only job parties");
        require(job.status == JobStatus.Created || job.status == JobStatus.Submitted, "Cannot dispute this job");
        job.status = JobStatus.Disputed;
        emit DisputeRaised(jobId, msg.sender);
    }

    /// @dev A resolved dispute is terminal and recorded as Completed, even if the client receives a refund.
    /// The event records the actual split. Integer rounding remainder goes to the client.
    function resolveDispute(uint256 jobId, uint256 freelancerPercent) external existingJob(jobId) {
        Job storage job = jobs[jobId];
        require(msg.sender == arbiter, "Only arbiter");
        require(job.status == JobStatus.Disputed, "Job is not disputed");
        require(freelancerPercent <= 100, "Percent exceeds 100");
        // Divide first to avoid overflowing when computing the percentage.
        uint256 freelancerAmount = (job.amount / 100) * freelancerPercent + (job.amount % 100) * freelancerPercent / 100;
        uint256 clientAmount = job.amount - freelancerAmount;
        job.status = JobStatus.Completed;
        emit JobCompleted(jobId, freelancerAmount, clientAmount);
        if (freelancerAmount > 0) _send(job.freelancer, freelancerAmount);
        if (clientAmount > 0) _send(job.client, clientAmount);
    }

    function _send(address payable recipient, uint256 amount) private {
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "ETH transfer failed");
    }
}
