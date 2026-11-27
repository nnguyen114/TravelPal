package com.travelpal.destination;

/** SAME_DAY: the optimizer may reorder or retime the place within its day, but never moves it to another day. */
public enum Flexibility { FIXED, PREFERRED, FLEXIBLE, SAME_DAY }
