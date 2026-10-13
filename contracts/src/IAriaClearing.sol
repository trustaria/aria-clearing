// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Aria Clearing
/// @notice Escrow, event log and settlement for sponsored lines in AI answers.
/// Every event carries the exact sentence shown and the advertiser's approved claims,
/// so a receipt can be verified from chain data alone.
///
/// Hash recipe:
///   claimsHash    = keccak256(bytes(claims))     claims: numbered lines "1. ...", no trailing newline
///   rationaleHash = keccak256(bytes(rationale))  rationale: the rendered string, trimmed, NFC
///   requestKey    = keccak256(bytes(requestId))
///   eventId       = keccak256(abi.encode(requestId, kind))
///
/// Settlement report, delivered through the CRE forwarder to `onReport(bytes metadata, bytes report)`:
///   report = abi.encode(uint64 reportedAt, bytes32[] release, bytes32[] reject)
/// Ids that are unknown, already settled or still inside the dispute window are skipped, never reverted.
/// A report whose `reportedAt` is not greater than the last accepted one is ignored.
/// A disputed event is always refunded, whichever list it appears in.
/// A released event pays the publisher directly (`PaidOut`); if that transfer fails, the amount
/// is credited instead (`PayoutDeferred`) and the publisher pulls it with `claim()`.
/// Fee: only on release, `fee = price * feeBps / 10_000` (rounded down) accrues to `fees`; the publisher
/// gets `price - fee`. Rejected and disputed events are refunded in full. `withdrawFees()` pays `feeRecipient`.
interface IAriaClearing {
    enum Kind {
        Impression,
        Click
    }

    enum Status {
        None,
        Logged,
        Disputed,
        Released,
        Rejected
    }

    struct Campaign {
        address advertiser;
        bytes32 claimsHash;
        uint256 priceImpression;
        uint256 priceClick;
        uint256 available;
        uint256 reserved;
    }

    struct ClearingEvent {
        bytes32 campaignId;
        address publisher;
        Kind kind;
        Status status;
        uint64 loggedAt;
        uint256 price;
    }

    event CampaignCreated(
        bytes32 indexed campaignId,
        address indexed advertiser,
        string claims,
        bytes32 claimsHash,
        uint256 priceImpression,
        uint256 priceClick,
        uint256 budget
    );

    event EventLogged(
        bytes32 indexed eventId,
        bytes32 indexed requestKey,
        bytes32 indexed campaignId,
        string requestId,
        address publisher,
        Kind kind,
        string rationale,
        bytes32 rationaleHash,
        uint8[] claimRefs,
        uint256 price
    );

    event EventDisputed(bytes32 indexed eventId);

    /// @param outcome Status.Released or Status.Rejected
    event EventSettled(bytes32 indexed eventId, Status outcome);

    /// @param amount The publisher's net, `price - fee`.
    event PaidOut(bytes32 indexed eventId, address indexed publisher, uint256 amount, uint256 fee);

    /// @param amount The publisher's net, credited for `claim()`.
    event PayoutDeferred(bytes32 indexed eventId, address indexed publisher, uint256 amount, uint256 fee);

    event Claimed(address indexed publisher, uint256 amount);

    event Withdrawn(bytes32 indexed campaignId, uint256 amount);

    event FeesWithdrawn(address indexed recipient, uint256 amount);

    error NotRelayer();
    error NotAdvertiser();
    error NotForwarder();
    error CampaignExists();
    error UnknownCampaign();
    error AlreadyLogged();
    error InsufficientBudget();
    error NotDisputable();
    error NothingToClaim();
    error FeeTooHigh();
    error InvalidFeeRecipient();
    error NothingToWithdraw();

    /// @notice Pulls `amount` USDC from the caller, who becomes the campaign's advertiser.
    function createCampaign(
        bytes32 campaignId,
        string calldata claims,
        uint256 priceImpression,
        uint256 priceClick,
        uint256 amount
    ) external;

    /// @notice Relayer only. Reserves the event's price from the campaign.
    function logEvent(
        string calldata requestId,
        bytes32 campaignId,
        address publisher,
        Kind kind,
        string calldata rationale,
        uint8[] calldata claimRefs
    ) external returns (bytes32 eventId);

    /// @notice Campaign advertiser only, while the event is Logged and inside the dispute window.
    function dispute(bytes32 eventId) external;

    /// @notice Transfers the caller's credit left by deferred payouts.
    function claim() external returns (uint256 amount);

    /// @notice Advertiser only. Returns the campaign's unreserved budget.
    function withdraw(bytes32 campaignId) external returns (uint256 amount);

    /// @notice Anyone. Transfers all accrued fees to `feeRecipient`.
    function withdrawFees() external returns (uint256 amount);

    /// @notice Events still Logged or Disputed, with their state, in one read.
    function pendingEvents() external view returns (bytes32[] memory ids, ClearingEvent[] memory events);

    function campaign(bytes32 campaignId) external view returns (Campaign memory);

    function clearingEvent(bytes32 eventId) external view returns (ClearingEvent memory);

    function credit(address publisher) external view returns (uint256);

    function eventIdOf(string calldata requestId, Kind kind) external pure returns (bytes32);

    function usdc() external view returns (address);

    function relayer() external view returns (address);

    function forwarder() external view returns (address);

    function disputeWindow() external view returns (uint64);

    function lastReportedAt() external view returns (uint64);

    /// @notice Fee on released events, in basis points of the price.
    function feeBps() external view returns (uint16);

    function feeRecipient() external view returns (address);

    /// @notice Accrued fees not yet withdrawn.
    function fees() external view returns (uint256);
}
