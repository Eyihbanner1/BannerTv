package com.bannertv.app.helper

import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress

/**
 * Who may use the stream helper, and what it may fetch. No Android imports, so JVM unit tests
 * run it as it is.
 */
object AddressRules {
    /** A device on the home network: a private or link-local address, or this device itself. */
    fun isHomeClient(address: InetAddress): Boolean =
        address.isLoopbackAddress ||
            address.isSiteLocalAddress ||
            address.isLinkLocalAddress ||
            isUniqueLocal(address)

    /**
     * An address on the public internet. The helper never fetches from the home network (the
     * router's admin page, say) or from addresses that are never meant to be reached.
     */
    fun isPublicTarget(address: InetAddress): Boolean {
        if (
            address.isAnyLocalAddress ||
            address.isLoopbackAddress ||
            address.isSiteLocalAddress ||
            address.isLinkLocalAddress ||
            address.isMulticastAddress ||
            isUniqueLocal(address)
        ) {
            return false
        }
        return when (address) {
            is Inet4Address -> isPublicV4(address.address)
            is Inet6Address -> isPublicV6(address.address)
            else -> false
        }
    }

    /**
     * The address the TV reaches this device on: a private IPv4 address, Wi-Fi or Ethernet
     * first. interfaces are (name, address) pairs for the interfaces that are up.
     */
    fun homeAddress(interfaces: List<Pair<String, InetAddress>>): InetAddress? {
        val home = interfaces.filter { (_, address) ->
            address is Inet4Address && address.isSiteLocalAddress && !address.isLoopbackAddress
        }
        val preferred = home.firstOrNull { (name, _) -> name.startsWith("wlan") || name.startsWith("eth") }
        return (preferred ?: home.firstOrNull())?.second
    }

    private fun isPublicV4(bytes: ByteArray): Boolean {
        val a = bytes[0].toInt() and 0xff
        val b = bytes[1].toInt() and 0xff
        val c = bytes[2].toInt() and 0xff
        return when {
            a == 0 -> false // "this network"
            a == 100 && b in 64..127 -> false // carrier-grade NAT, shared like a home network
            a == 192 && b == 0 && c == 0 -> false // protocol assignments
            a == 198 && (b == 18 || b == 19) -> false // benchmarking
            a >= 240 -> false // reserved and broadcast
            else -> true
        }
    }

    private fun isPublicV6(bytes: ByteArray): Boolean {
        // 64:ff9b::/96 carries an IPv4 address (NAT64): judge the address inside.
        val nat64 = byteArrayOf(0, 0x64, 0xff.toByte(), 0x9b.toByte(), 0, 0, 0, 0, 0, 0, 0, 0)
        if (bytes.copyOfRange(0, 12).contentEquals(nat64)) {
            val inner = InetAddress.getByAddress(bytes.copyOfRange(12, 16))
            return isPublicTarget(inner)
        }
        // Only global unicast (2000::/3) is public.
        return (bytes[0].toInt() and 0xe0) == 0x20
    }

    private fun isUniqueLocal(address: InetAddress): Boolean =
        address is Inet6Address && (address.address[0].toInt() and 0xfe) == 0xfc
}
