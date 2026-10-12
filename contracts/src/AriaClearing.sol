// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IAriaClearing} from "./IAriaClearing.sol";
import {IReceiver} from "./IReceiver.sol";

/// @title Aria Clearing
/// @notice Escrows advertiser USDC, logs each sponsored-line event with its receipt data,
/// and settles events from CRE reports delivered by the forwarder, paying publishers directly.
contract AriaClearing is IAriaClearing, IReceiver {
    using SafeERC20 for IERC20;

    event ForwarderSet(address forwarder);

    error NotOwner();

    address public immutable owner;
    address public immutable usdc;
    address public immutable relayer;
    uint64 public immutable disputeWindow;

    address public forwarder;
    uint64 public lastReportedAt;

    mapping(address publisher => uint256) public credit;

    mapping(bytes32 campaignId => Campaign) private _campaigns;
    mapping(bytes32 eventId => ClearingEvent) private _events;

    /// @dev Ids of Logged or Disputed events, with 1-based positions for swap-and-pop removal.
    bytes32[] private _pending;
    mapping(bytes32 eventId => uint256) private _pendingPosition;

    constructor(address usdc_, address relayer_, address forwarder_, uint64 disputeWindow_) {
        owner = msg.sender;
        usdc = usdc_;
        relayer = relayer_;
        forwarder = forwarder_;
        disputeWindow = disputeWindow_;
        emit ForwarderSet(forwarder_);
    }

    // ---------- advertiser ----------

    function createCampaign(
        bytes32 campaignId,
        string calldata claims,
        uint256 priceImpression,
        uint256 priceClick,
        uint256 amount
    ) external {
        if (_campaigns[campaignId].advertiser != address(0)) revert CampaignExists();
        bytes32 claimsHash = keccak256(bytes(claims));
        _campaigns[campaignId] = Campaign({
            advertiser: msg.sender,
            claimsHash: claimsHash,
            priceImpression: priceImpression,
            priceClick: priceClick,
            available: amount,
            reserved: 0
        });
        IERC20(usdc).safeTransferFrom(msg.sender, address(this), amount);
        emit CampaignCreated(campaignId, msg.sender, claims, claimsHash, priceImpression, priceClick, amount);
    }

    function dispute(bytes32 eventId) external {
        ClearingEvent storage e = _events[eventId];
        if (msg.sender != _campaigns[e.campaignId].advertiser) revert NotAdvertiser();
        if (e.status != Status.Logged || !_windowOpen(e.loggedAt)) revert NotDisputable();
        e.status = Status.Disputed;
        emit EventDisputed(eventId);
    }

    function withdraw(bytes32 campaignId) external returns (uint256 amount) {
        Campaign storage c = _campaigns[campaignId];
        if (msg.sender != c.advertiser) revert NotAdvertiser();
        amount = c.available;
        c.available = 0;
        if (amount != 0) IERC20(usdc).safeTransfer(msg.sender, amount);
        emit Withdrawn(campaignId, amount);
    }

    // ---------- relayer ----------

    function logEvent(
        string calldata requestId,
        bytes32 campaignId,
        address publisher,
        Kind kind,
        string calldata rationale,
        uint8[] calldata claimRefs
    ) external returns (bytes32 eventId) {
        if (msg.sender != relayer) revert NotRelayer();
        eventId = keccak256(abi.encode(requestId, kind));
        if (_events[eventId].status != Status.None) revert AlreadyLogged();

        Campaign storage c = _campaigns[campaignId];
        if (c.advertiser == address(0)) revert UnknownCampaign();
        uint256 price = kind == Kind.Click ? c.priceClick : c.priceImpression;
        if (c.available < price) revert InsufficientBudget();
        c.available -= price;
        c.reserved += price;

        _events[eventId] = ClearingEvent({
            campaignId: campaignId,
            publisher: publisher,
            kind: kind,
            status: Status.Logged,
            loggedAt: uint64(block.timestamp),
            price: price
        });
        _pending.push(eventId);
        _pendingPosition[eventId] = _pending.length;

        emit EventLogged(
            eventId,
            keccak256(bytes(requestId)),
            campaignId,
            requestId,
            publisher,
            kind,
            rationale,
            keccak256(bytes(rationale)),
            claimRefs,
            price
        );
    }

    // ---------- settlement ----------

    /// @notice Forwarder only. Pays released events to their publishers and refunds rejected ones.
    /// Skips stale reports and ids it cannot settle; never reverts inside the loop.
    function onReport(bytes calldata, bytes calldata report) external {
        if (msg.sender != forwarder) revert NotForwarder();
        (uint64 reportedAt, bytes32[] memory release, bytes32[] memory reject) =
            abi.decode(report, (uint64, bytes32[], bytes32[]));
        if (reportedAt <= lastReportedAt) return;
        lastReportedAt = reportedAt;

        for (uint256 i; i < release.length; ++i) {
            _settle(release[i], true);
        }
        for (uint256 i; i < reject.length; ++i) {
            _settle(reject[i], false);
        }
    }

    function claim() external returns (uint256 amount) {
        amount = credit[msg.sender];
        if (amount == 0) revert NothingToClaim();
        credit[msg.sender] = 0;
        IERC20(usdc).safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    // ---------- owner ----------

    function setForwarder(address forwarder_) external {
        if (msg.sender != owner) revert NotOwner();
        forwarder = forwarder_;
        emit ForwarderSet(forwarder_);
    }

    // ---------- views ----------

    function pendingEvents() external view returns (bytes32[] memory ids, ClearingEvent[] memory events) {
        ids = _pending;
        events = new ClearingEvent[](ids.length);
        for (uint256 i; i < ids.length; ++i) {
            events[i] = _events[ids[i]];
        }
    }

    function campaign(bytes32 campaignId) external view returns (Campaign memory) {
        return _campaigns[campaignId];
    }

    function clearingEvent(bytes32 eventId) external view returns (ClearingEvent memory) {
        return _events[eventId];
    }

    function eventIdOf(string calldata requestId, Kind kind) external pure returns (bytes32) {
        return keccak256(abi.encode(requestId, kind));
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    // ---------- internal ----------

    function _windowOpen(uint64 loggedAt) private view returns (bool) {
        return block.timestamp < uint256(loggedAt) + disputeWindow;
    }

    /// @dev Disputed events are refunded whichever list they arrive in.
    function _settle(bytes32 eventId, bool release) private {
        ClearingEvent storage e = _events[eventId];
        Status status = e.status;
        if (status != Status.Logged && status != Status.Disputed) return;
        if (_windowOpen(e.loggedAt)) return;

        uint256 price = e.price;
        Campaign storage c = _campaigns[e.campaignId];
        c.reserved -= price;

        Status outcome = release && status == Status.Logged ? Status.Released : Status.Rejected;
        if (outcome == Status.Rejected) c.available += price;
        e.status = outcome;
        _removePending(eventId);
        emit EventSettled(eventId, outcome);

        if (outcome == Status.Released) _payOut(eventId, e.publisher, price);
    }

    /// @dev Transfers to the publisher without reverting; a failed transfer becomes claimable credit.
    function _payOut(bytes32 eventId, address publisher, uint256 amount) private {
        if (IERC20(usdc).trySafeTransfer(publisher, amount)) {
            emit PaidOut(eventId, publisher, amount);
        } else {
            credit[publisher] += amount;
            emit PayoutDeferred(eventId, publisher, amount);
        }
    }

    function _removePending(bytes32 eventId) private {
        uint256 position = _pendingPosition[eventId];
        uint256 lastPosition = _pending.length;
        if (position != lastPosition) {
            bytes32 moved = _pending[lastPosition - 1];
            _pending[position - 1] = moved;
            _pendingPosition[moved] = position;
        }
        _pending.pop();
        delete _pendingPosition[eventId];
    }
}
