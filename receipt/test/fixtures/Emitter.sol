// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Emits the IAriaClearing events with caller-supplied values and serves the matching views, for receipt tests.
contract Emitter {
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
        uint8 kind;
        uint8 status;
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
        uint8 kind,
        string rationale,
        bytes32 rationaleHash,
        uint8[] claimRefs,
        uint256 price
    );
    event EventDisputed(bytes32 indexed eventId);
    event EventSettled(bytes32 indexed eventId, uint8 outcome);
    event PaidOut(bytes32 indexed eventId, address indexed publisher, uint256 amount, uint256 fee);

    mapping(bytes32 => Campaign) private campaigns;
    mapping(bytes32 => ClearingEvent) private clearingEvents;

    function campaign(bytes32 campaignId) external view returns (Campaign memory) {
        return campaigns[campaignId];
    }

    function clearingEvent(bytes32 eventId) external view returns (ClearingEvent memory) {
        return clearingEvents[eventId];
    }

    function feeBps() external pure returns (uint16) {
        return 2000;
    }

    function campaignCreated(bytes32 campaignId, string calldata claims, bytes32 claimsHash) external {
        campaigns[campaignId] = Campaign(msg.sender, claimsHash, 10_000, 250_000, 5_000_000, 0);
        emit CampaignCreated(campaignId, msg.sender, claims, claimsHash, 10_000, 250_000, 5_000_000);
    }

    function eventLogged(
        bytes32 eventId,
        bytes32 campaignId,
        string calldata requestId,
        uint8 kind,
        string calldata rationale,
        bytes32 rationaleHash,
        uint8[] calldata claimRefs
    ) external {
        clearingEvents[eventId] = ClearingEvent(campaignId, msg.sender, kind, 1, uint64(block.timestamp), 10_000);
        emit EventLogged(
            eventId, keccak256(bytes(requestId)), campaignId, requestId, msg.sender, kind, rationale, rationaleHash, claimRefs, 10_000
        );
    }

    function eventDisputed(bytes32 eventId) external {
        clearingEvents[eventId].status = 2;
        emit EventDisputed(eventId);
    }

    function eventSettled(bytes32 eventId, uint8 outcome) external {
        clearingEvents[eventId].status = outcome;
        emit EventSettled(eventId, outcome);
    }

    /// Settles as released and pays out in the same transaction, with the caller's split.
    function eventReleased(bytes32 eventId, uint256 amount, uint256 fee) external {
        clearingEvents[eventId].status = 3;
        emit EventSettled(eventId, 3);
        emit PaidOut(eventId, clearingEvents[eventId].publisher, amount, fee);
    }
}
